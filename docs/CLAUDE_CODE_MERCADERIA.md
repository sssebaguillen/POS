# P-CC1 — Gastos de mercadería con ingreso de stock

Spec completa para implementar en sesión de Claude Code.  
Arquitecto: Claude (Anthropic). Fecha de diseño: abril 2026.

---

## Contexto

Pulsar ya tiene:
- Tabla `expenses` con `category` tipo `expense_category` (enum) que incluye el valor `'mercaderia'`
- Tabla `inventory_movements` con `type text`, `reference_id uuid`, `created_by_operator uuid`
- Tabla `products` con `stock integer`, `cost numeric`
- RPC `create_expense` para gastos simples (no tocar — sigue funcionando para las otras categorías)

Lo que falta: cuando la categoría es `mercaderia`, el gasto tiene líneas de productos. Cada línea actualiza stock y opcionalmente actualiza el costo del producto.

---

## 1. Migraciones SQL

### 1.1 Nueva tabla `expense_items`

```sql
create table public.expense_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null, -- snapshot del nombre al momento de la compra
  quantity     integer not null check (quantity > 0),
  unit_cost    numeric not null check (unit_cost >= 0),
  subtotal     numeric generated always as (quantity * unit_cost) stored,
  update_cost  boolean not null default false,
  created_at   timestamptz default now()
);

alter table public.expense_items enable row level security;

create policy "owner_manage_expense_items"
  on public.expense_items
  for all
  using (business_id = get_business_id());

-- Índices FK
create index idx_expense_items_expense_id on public.expense_items(expense_id);
create index idx_expense_items_product_id on public.expense_items(product_id);
create index idx_expense_items_business_id on public.expense_items(business_id);
```

### 1.2 Columna `item_count` en `expenses` (desnormalizada para display)

No agregar — se calcula en la RPC de listado con un subquery. Evitar desnormalización innecesaria.

---

## 2. Nueva RPC `create_mercaderia_expense`

**Principios:**
- SECURITY DEFINER + `set search_path = public`
- Guard de `business_id` al inicio — si falla, retorna `{success: false, error: 'unauthorized'}`
- Transacción atómica: si falla cualquier paso, no queda nada insertado
- No modifica la RPC `create_expense` existente

```sql
create or replace function public.create_mercaderia_expense(
  p_business_id    uuid,
  p_description    text,
  p_date           date default current_date,
  p_supplier_id    uuid default null,
  p_operator_id    uuid default null,
  p_notes          text default null,
  p_items          jsonb default '[]',
  -- cada item: {product_id, product_name, quantity, unit_cost, update_cost}
  p_update_stock   boolean default true
  -- false si el operador tiene 'expenses' pero no 'stock_write'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_total      numeric := 0;
  v_item       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_cost       numeric;
  v_name       text;
  v_update     boolean;
begin
  -- Guard de tenant
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Validar que hay al menos un item
  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'no_items');
  end if;

  -- Calcular total
  select sum((item->>'unit_cost')::numeric * (item->>'quantity')::integer)
  into v_total
  from jsonb_array_elements(p_items) as item;

  -- Insertar gasto
  insert into public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id, notes
  ) values (
    p_business_id, 'mercaderia', v_total, p_description, p_date,
    p_supplier_id, p_operator_id, p_notes
  )
  returning id into v_expense_id;

  -- Procesar cada item
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;
    v_cost       := (v_item->>'unit_cost')::numeric;
    v_name       := v_item->>'product_name';
    v_update     := coalesce((v_item->>'update_cost')::boolean, false);

    -- Insertar expense_item
    insert into public.expense_items (
      business_id, expense_id, product_id, product_name,
      quantity, unit_cost, update_cost
    ) values (
      p_business_id, v_expense_id, v_product_id, v_name,
      v_qty, v_cost, v_update
    );

    -- Actualizar stock e inventory_movement (si stock_write permitido)
    if p_update_stock and v_product_id is not null then
      update public.products
      set stock = stock + v_qty
      where id = v_product_id and business_id = p_business_id;

      -- Actualizar costo si el usuario lo indicó
      if v_update then
        update public.products
        set cost = v_cost
        where id = v_product_id and business_id = p_business_id;
      end if;

      -- Registrar movimiento
      insert into public.inventory_movements (
        business_id, product_id, type, quantity,
        reason, reference_id, created_by_operator
      ) values (
        p_business_id, v_product_id, 'purchase', v_qty,
        'Compra de mercadería — gasto #' || v_expense_id::text,
        v_expense_id,
        p_operator_id
      );
    end if;
  end loop;

  return jsonb_build_object('success', true, 'id', v_expense_id, 'total', v_total);
end;
$$;

grant execute on function public.create_mercaderia_expense to authenticated;
```

---

## 3. Modificación de `get_expenses_list`

Agregar `item_count` al resultado para mostrar un badge "N productos" en la tabla de gastos cuando `category = 'mercaderia'`. Usar subquery para no cambiar la firma:

En la SELECT del RPC existente, agregar:
```sql
(select count(*) from public.expense_items ei where ei.expense_id = e.id) as item_count
```

---

## 4. Componentes UI

### 4.1 Estructura de archivos

```
components/expenses/
  ExpensesPanel.tsx           -- existente, no tocar estructura general
  NewExpenseModal.tsx         -- existente, MODIFICAR para agregar sección mercadería
  MercaderiaItemsSection.tsx  -- NUEVO — sección de productos dentro del modal
  ProductSearchInput.tsx      -- NUEVO — input de búsqueda con debounce + dropdown
```

### 4.2 `MercaderiaItemsSection.tsx`

Props:
```typescript
interface MercaderiaItemsSectionProps {
  businessId: string
  items: MercaderiaItem[]
  onItemsChange: (items: MercaderiaItem[]) => void
  canUpdateStock: boolean // permissions.stock_write
}

interface MercaderiaItem {
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number
  update_cost: boolean
  // solo para UI:
  _original_cost: number // para mostrar si cambió
}
```

**Comportamiento:**
- Al agregar un producto: pre-rellenar `unit_cost` con `product.cost` de DB; `update_cost: false` por defecto
- `unit_cost` es editable en el modal (one-time) — no modifica el producto hasta guardar
- Toggle "Actualizar costo" por línea — visible siempre (aunque `canUpdateStock = false` se deshabilita y muestra tooltip "Sin permiso de escritura")
- No permitir agregar el mismo `product_id` dos veces — si ya existe, incrementar quantity en lugar de agregar línea nueva
- Total calculado: `SUM(item.quantity * item.unit_cost)` — display-only debajo de la lista

### 4.3 `ProductSearchInput.tsx`

- Debounce de 300ms sobre input de texto
- Query: `products` donde `business_id = businessId AND is_active = true` filtrado por `name ILIKE` o `barcode =`
- Máximo 8 resultados en dropdown
- Muestra: nombre, stock actual, costo actual
- Al seleccionar: llama `onSelect(product)` y limpia el input
- Botón "+ Crear producto nuevo" al final del dropdown (siempre visible cuando hay texto):
  - Abre `NewProductModal` con `initialName` pre-rellenado con el texto del input
  - Al cerrarse con éxito: el nuevo producto se agrega automáticamente como línea (no hay que buscarlo)

### 4.4 Modificación de `NewExpenseModal.tsx`

Lógica de render condicional:
```typescript
const isMercaderia = selectedCategory === 'mercaderia'
```

Cuando `isMercaderia`:
- Mostrar `<MercaderiaItemsSection />`
- El campo `amount` se deshabilita y muestra el total calculado de los items
- Al submit: llamar `create_mercaderia_expense` en lugar de `create_expense`
- Pasar `p_update_stock: permissions.stock_write` — si el operador no tiene `stock_write`, el gasto se crea pero sin tocar stock/costo

Cuando no es mercadería: comportamiento idéntico al actual.

---

## 5. Llamada al RPC desde el cliente

```typescript
const { data, error } = await supabase.rpc('create_mercaderia_expense', {
  p_business_id: businessId,
  p_description: description,
  p_date: date,
  p_supplier_id: supplierId ?? null,
  p_operator_id: operatorId ?? null,
  p_notes: notes ?? null,
  p_items: items.map(i => ({
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity,
    unit_cost: i.unit_cost,
    update_cost: i.update_cost,
  })),
  p_update_stock: permissions.stock_write,
})
```

---

## 6. Permisos y multi-tenancy

- **Permiso para ver el formulario:** `permissions.expenses === true`
- **`p_update_stock`:** `permissions.stock_write` — si false, el RPC crea el gasto sin tocar `products` ni `inventory_movements`
- **Multi-tenancy:** la RPC hace el guard de `auth.uid()` → `profiles.business_id`. `expense_items` tiene RLS con `business_id = get_business_id()`. La búsqueda de productos en el cliente filtra por `businessId` de `profiles` — nunca hay datos cross-tenant.

---

## 7. Badge en tabla de gastos

En `ExpensesPanel.tsx`, cuando una fila tiene `category === 'mercaderia'` y `item_count > 0`, mostrar un badge discreto:

```tsx
{expense.category === 'mercaderia' && expense.item_count > 0 && (
  <span className="text-xs text-muted-foreground">
    {expense.item_count} producto{expense.item_count !== 1 ? 's' : ''}
  </span>
)}
```

---

## 8. Scope explícito — qué NO entra en esta iteración

- Editar un gasto de mercadería ya guardado (requiere reversión de stock — post-beta)
- Ver el detalle completo de items de un gasto desde la tabla (post-beta)
- Ajustes negativos de stock (merma/pérdida) — flujo separado futuro
- Costo promedio ponderado automático — post-beta
- Ordenes de compra formales (purchase_orders) — eso es P9 completo

---

## 9. Orden de implementación sugerido para la sesión

1. Migración SQL: `expense_items` + grants
2. RPC `create_mercaderia_expense` + grant
3. Modificar `get_expenses_list` para incluir `item_count`
4. `ProductSearchInput.tsx`
5. `MercaderiaItemsSection.tsx`
6. Modificar `NewExpenseModal.tsx`
7. Badge en `ExpensesPanel.tsx`
8. Test manual: crear gasto mercadería, verificar stock actualizado, verificar `inventory_movements`

---

## 10. Integración en onboarding

Ver `ONBOARDING_MERCADERIA.md` — paso adicional en el wizard existente que guía al usuario la primera vez que registra un gasto de mercadería.
