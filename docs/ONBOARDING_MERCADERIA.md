# ONBOARDING_MERCADERIA.md — Integración al onboarding

Spec del paso de onboarding específico para la feature de gastos de mercadería.  
Se implementa junto con P-CC1.

---

## Contexto

El flujo de gastos de mercadería es el más complejo de toda la app para un usuario nuevo:
- Tiene una UI que se transforma según la categoría seleccionada
- Implica buscar/crear productos dentro de un modal de gasto
- Tiene comportamientos no obvios (costo pre-rellenado, toggle de actualizar costo, total automático)

El onboarding general ya cubre los pasos de configuración inicial. Este spec define **un mini-onboarding contextual** que se activa la primera vez que el usuario selecciona la categoría "Mercadería" en el modal de nuevo gasto — no es un paso del wizard principal.

---

## Enfoque: tooltip guiado en contexto (no wizard separado)

Al detectar que es la primera vez que el usuario usa la categoría mercadería, se activa una secuencia de **3 tooltips de highlight** que aparecen secuencialmente sobre los elementos clave de la UI, igual que hacen Notion, Linear y apps similares.

No es un modal bloqueante — el usuario puede cerrar los tooltips en cualquier momento y seguir usando la feature normalmente.

---

## Detección de "primera vez"

```typescript
// En localStorage (no en DB — es preferencia de sesión local)
const key = 'pulsar_onboarding_mercaderia_done'
const isDone = localStorage.getItem(key) === 'true'

// Al completar el tercer tooltip o al guardar el primer gasto de mercadería:
localStorage.setItem(key, 'true')
```

Alternativa si se quiere persistir en DB: agregar columna `onboarding_flags jsonb` en `profiles` o `businesses`. Para beta, `localStorage` es suficiente.

---

## Secuencia de tooltips

### Tooltip 1 — Búsqueda de productos

**Aparece sobre:** `ProductSearchInput`  
**Título:** "Buscá el producto que recibiste"  
**Texto:** "Escribí el nombre o escaneá el código de barras. Si el producto no existe todavía, podés crearlo desde acá."  
**Acción:** botón "Entendido →"

### Tooltip 2 — Edición de costo y toggle

**Aparece sobre:** la primera línea de producto agregada, específicamente sobre el campo `unit_cost` y el toggle `update_cost`  
**Título:** "El costo viene de tu catálogo"  
**Texto:** "Podés editarlo si el precio cambió. Activá 'Actualizar costo' para que ese nuevo precio quede guardado en el producto."  
**Acción:** botón "Entendido →"

### Tooltip 3 — Total automático

**Aparece sobre:** el total calculado al pie de la sección de items  
**Título:** "El total se calcula solo"  
**Texto:** "El monto del gasto es la suma de todos los productos. Al guardar, el stock de cada uno se actualiza automáticamente."  
**Acción:** botón "Listo" — marca el onboarding como completado

---

## Componente

```
components/onboarding/
  MercaderiaOnboarding.tsx  -- NUEVO
```

Props:
```typescript
interface MercaderiaOnboardingProps {
  active: boolean           // true solo si es primera vez
  onComplete: () => void    // marca localStorage y desmonta
}
```

Implementar con un portal (`createPortal`) para posicionar los tooltips sobre los elementos target sin romper el z-index del modal. Usar refs pasados desde `MercaderiaItemsSection` hacia el componente de onboarding.

Estilo: seguir el design system de Pulsar — fondo del tooltip en `bg-primary`, texto `text-primary-foreground`, flecha apuntando al elemento target. Sin animaciones complejas — fade in/out simple.

---

## Integración en `NewExpenseModal.tsx`

```typescript
const [showMercaderiaOnboarding, setShowMercaderiaOnboarding] = useState(false)

// Cuando se selecciona mercadería por primera vez en esta sesión:
useEffect(() => {
  if (selectedCategory === 'mercaderia') {
    const done = localStorage.getItem('pulsar_onboarding_mercaderia_done')
    if (!done) setShowMercaderiaOnboarding(true)
  }
}, [selectedCategory])

// En el render:
{showMercaderiaOnboarding && (
  <MercaderiaOnboarding
    active={true}
    onComplete={() => {
      localStorage.setItem('pulsar_onboarding_mercaderia_done', 'true')
      setShowMercaderiaOnboarding(false)
    }}
  />
)}
```

---

## Lo que NO hace este onboarding

- No bloquea el uso de la feature — el usuario puede ignorar los tooltips
- No requiere que el usuario complete todos los pasos para guardar el gasto
- No aparece en sesiones siguientes una vez marcado como completado
- No requiere ningún cambio en la DB

---

## Consideración futura

Si se implementa PostHog (P-CC3), trackear:
```typescript
posthog.capture('onboarding_mercaderia_started')
posthog.capture('onboarding_mercaderia_completed')
posthog.capture('onboarding_mercaderia_dismissed', { at_step: stepIndex })
```
