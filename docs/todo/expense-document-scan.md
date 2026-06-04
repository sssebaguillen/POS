# Escaneo de documentos en Gastos — extracción automática (plan MVP)

> Estado: **backend deployado+validado; frontend implementado (typecheck+lint OK), falta test en navegador.** (2026-06-04)
> - Edge Function `extract-expense` desplegada en prod (`zrnthcznbrplzpmxmkwk`) y probada
>   contra Groq: modo `text` extrae bien proveedor/fecha/monto/categoría/descripción de facturas
>   AR (total vs subtotal/IVA, formato de miles/decimales, `DD/MM/AAAA`→ISO); guards de seguridad OK
>   (path ajeno→403, modo inválido→400, sin JWT→401 por gateway).
> - Frontend: `ExpenseScanCard` (botón "Escanear con IA" + tarjeta Aplicar/Descartar) montado en
>   `NewExpensePanel` (rama no-mercadería). PDF→modo `pdf`; Excel/CSV→parseo client-side (SheetJS
>   dynamic import) → modo `text`. Match difuso de proveedor contra `suppliers`. Si la IA clasifica
>   `mercaderia`, se remapea a `proveedores` (header-only no itemiza; ver fase 2).
> - **Pendiente:** test en navegador del flujo subir→escanear→aplicar; modo `pdf` end-to-end con un
>   PDF real; (luego) replicar en `EditExpensePanel` si se valida.

## Context

En `/expenses`, el usuario hoy carga un gasto a mano y opcionalmente adjunta el comprobante.
La idea es invertir el flujo: que suba el documento (factura/planilla), la IA **extraiga los datos
y pre-llene el formulario**, y el usuario solo **valide y corrija**. Encaja con el principio de
producto: la IA acelera, no bloquea — el dueño siempre confirma antes de guardar.

El usuario objetivo de esta feature **ya recibe todo electrónico**: facturas en PDF y planillas
Excel con el detalle. Por eso el MVP **no necesita visión/OCR** — alcanza con extraer texto.
La foto del ticket térmico (visión) se suma después, no en el MVP.

## Alcance del MVP (acordado)

**Solo texto. Solo el encabezado del gasto.**

Pre-llena: `proveedor` (match difuso contra `suppliers`), `fecha`, `monto` (total),
`categoría` (mejor esfuerzo), `descripción`. El usuario valida y guarda con el flujo actual
(`create_expense` — sin cambios en el guardado).

| Tipo de archivo | Ruta de extracción | Método del provider |
|---|---|---|
| **PDF con capa de texto** (factura electrónica) | Edge fn extrae texto con `unpdf` → LLM de texto | `completeJson` (ya existe) |
| **Excel/CSV** | Parseo client-side (SheetJS) → tabla en texto → LLM de texto | `completeJson` (ya existe) |
| **PDF escaneado** (sin capa de texto) | Fallback: "no pudimos leerlo, completá manual" | — |

**Fuera del MVP (fases siguientes):**
- **Imágenes / foto del ticket** → requiere método de visión nuevo (`completeJsonWithImage`,
  Groq Llama-4). Se incluirá, pero no ahora.
- **Auto-completado de gastos de tipo mercadería** (line-items + match de cada ítem al catálogo,
  con aliases por proveedor). Es la parte cara. Se retoma **cuando haya productos reales en la DB
  y un documento de ejemplo** para diseñar el matching contra un caso concreto.

## Decisiones cerradas

1. **Proveedor LLM: Groq primero, switch listo.** Reusa `GROQ_API_KEY` y el `makeProvider` actual
   ($0 free-tier). El provider ya abstrae por string de modelo, así que migrar a Gemini (mejor
   calidad, requiere billing en AR) es cambiar una env var si la calidad no alcanza. Ver
   [[p12-llm-provider]].
2. **Solo texto en el MVP.** Sin visión — el usuario objetivo recibe PDF/Excel electrónicos.
3. **Solo encabezado.** Sin line-items de mercadería todavía.
4. **No auto-crear proveedores.** Solo pre-selecciona si hay match claro contra `suppliers`.

## Arquitectura

### Edge Function `extract-expense` (pieza nueva más sensible)

A diferencia de `generate-insights` (cron + `CRON_SECRET` + service_role sobre todos los negocios),
esta corre **por usuario**:
- Autentica con el **JWT del dueño** (header `Authorization`), no `CRON_SECRET`.
- Hace `assert_tenant(p_business_id)` **antes** de tocar nada (regla 34).
- Para PDF: baja el archivo de `expense-receipts` (bucket privado) con service_role, extrae texto
  con `unpdf`; si no hay capa de texto → devuelve fallback.
- Para Excel/CSV: el texto ya viene parseado client-side en el body (no baja del bucket).
- Llama al LLM de texto y devuelve JSON `{ supplier_name, date, amount, category, description }`.

**Riesgo a vigilar:** al ser user-triggered (no nocturno), conviene un throttle por negocio; si no,
el free-tier TPM de Groq lo comparte con P12.

### Frontend (`NewExpensePanel` + `ExpenseAttachmentUploader`)

- Botón "Escanear con IA" sobre el adjunto ya subido.
- Estado de carga + pre-llenado de los campos del form.
- Hint discreto "rellenado por IA — revisá" (validar sin bloquear).
- Match difuso del nombre de proveedor extraído contra `suppliers` existentes.

## Esfuerzo estimado (~4 días)

- Edge fn `extract-expense` (modo PDF + modo texto pre-parseado) + auth/tenant — ~1 día
- `unpdf` + fallback PDF escaneado — ~0.5 día
- Parseo client-side de Excel/CSV (dep SheetJS) — ~0.5 día
- Prompt de extracción de texto (facturas AR) + iteración — ~1 día
- Frontend (botón, estados, pre-llenado, match de proveedor) — ~1 día
- Testing con docs reales (PDF + Excel) — ~0.5 día
