# Crítica de diseño — Onboarding

> Generado con `/impeccable critique` el 2026-06-25. Register: **product**.
> **Metodología (parcial por quota):** se corrió solo el *Assessment A* (revisión
> de diseño LLM sobre el código fuente). Se omitieron el *Assessment B*
> (detector determinístico `npx impeccable --json`) y el overlay visual en
> browser — el flujo está detrás de auth y la quota semanal de tokens estaba al
> 2%. Cuando haya margen, correr `npx impeccable --json src/components/onboarding`
> y el overlay `live` sobre `/dashboard` (wizard) para completar el score.

## Alcance revisado

Las 5 piezas del sistema de onboarding:

- `OnboardingWizard.tsx` — modal bloqueante de 5 pasos (datos → categoría → marca → producto → operador), montado en `/dashboard`.
- `OnboardingTourGate.tsx` — prompt opt-in descartable ("¿Quieres un recorrido rápido?").
- `OnboardingTour.tsx` — recorrido spotlight, **solo desktop**, ahora **11 pasos** tras la última ampliación.
- `OnboardingChecklist.tsx` — checklist persistente en el sidebar (6 ítems).
- `MercaderiaOnboarding.tsx` — coachmarks contextuales dentro de un gasto de mercadería (3 pasos).

---

## Design Health Score (Nielsen, Assessment A)

| # | Heurística | Score | Issue clave |
|---|-----------|-------|-------------|
| 1 | Visibilidad del estado | 3 | Wizard con dots + persistencia, checklist con progreso, tour con "N de M". Sólido. |
| 2 | Match con el mundo real | 3 | Copy cálido y de dominio ("fiado", "caja", "cuenta corriente"). Neutro (tú), sin voseo. |
| 3 | Control y libertad | 2 | Modal **no descartable**; el paso 0 atrapa hasta cargar nombre. "Completar después" solo aparece en paso > 0. |
| 4 | Consistencia y estándares | 2 | **Dos lenguajes de coachmark distintos**: tour (card + borde + flecha floating-ui) vs mercadería (relleno espresso `bg-primary` + flecha de triángulo CSS). z-index divergente (tour 80–82, mercadería 9999). |
| 5 | Prevención de errores | 3 | Pasos opcionales saltables; guard de campo obligatorio. Bien. |
| 6 | Reconocer vs recordar | 3 | Checklist siempre visible; spotlight apunta a elementos reales. |
| 7 | Flexibilidad y eficiencia | 2 | Tour **solo desktop** excluye al usuario de tablet (setup común en el target); sin navegación por teclado en el tour. |
| 8 | Estético y minimalista | 2 | Wizard limpio, pero el tour se infló a 11 pasos y rompe la promesa de "lo esencial". Modal-first. |
| 9 | Recuperación de errores | 2 | Errores inline (bien) pero se filtra `error.message` crudo de Supabase al usuario (viola DESIGN.md). |
| 10 | Ayuda y documentación | 3 | El tour ES la ayuda; opt-in; la ayuda contextual de mercadería es un acierto. |
| **Total** | | **25/40** | **Moderado — necesita trabajo focalizado** |

---

## Anti-Patterns Verdict

**¿Parece generado por IA?** No de forma evidente. La paleta Warm Ledger, la tipografía Sora/DM Sans y el tono cálido se respetan; no hay gradient text, glows, ni hero-metrics. El wizard se ve "crafted".

**Pero cae en un ban explícito del skill: "Modal as first thought".** El primer contacto del dueño con la app es un modal bloqueante (`showCloseButton={false}`, `onEscapeKeyDown`/`onPointerDownOutside` con `preventDefault`). Choca de frente con el principio de producto #1 ("Speed over completeness — la app no bloquea el flujo de venta") y con el #3 ("Trust the operator"). Está mitigado por "Completar después", pero ese escape **no existe en el paso 0**.

**Assessment B (detector determinístico + overlay):** NO ejecutado (quota). Pendiente.

---

## Lo que funciona

1. **Onboarding contextual de mercadería.** Coachmarks anclados al elemento real, en el momento del uso, con condición `requiresItems`. Es el patrón correcto ("context over documentation", principio #2) y debería ser el modelo para el resto.
2. **Resiliencia del tour.** `router.push` + retry de ruta + retry de target + skip-on-not-found evita que un elemento ausente rompa el recorrido. Buena ingeniería defensiva.
3. **Persistencia y reanudación.** El wizard guarda paso a paso en `onboarding_state`; el checklist permite retomar; el sidebar colapsado muestra el ícono Sparkle. El estado nunca se pierde.

---

## Priority Issues

### [P1] El tour ya no es "lo esencial en menos de un minuto"
- **Qué:** El gate promete "Te muestro lo esencial en menos de un minuto", pero el tour ahora tiene **11 pasos**, cada uno con navegación de ruta. Realísticamente son 2–4 minutos.
- **Por qué importa:** Rompe la expectativa que el propio prompt fijó (peak-end / confianza). Un dueño apurado abandona a la mitad y se pierde lo que viene al final ("Todo listo", permisos).
- **Fix:** O bien (a) recortar a 5–6 pasos troncales y mover el resto a descubrimiento contextual estilo mercadería, o (b) ajustar el copy del gate ("recorrido de ~2 min" + permitir reanudar donde se dejó). Recomendado: (a).
- **Suggested command:** `$impeccable distill`

### [P1] El tour no existe en tablet/mobile
- **Qué:** En `< 1024px` el tour muestra solo "Tour guiado disponible en desktop" + botón Saltar.
- **Por qué importa:** PRODUCT.md marca explícitamente que el setup en tablet es común en comercios argentinos. Para esos dueños, la guía principal del producto simplemente no aparece.
- **Fix:** Versión mobile real: bottom-sheet secuencial que navega a cada vista y describe en texto (sin spotlight posicional), reusando los mismos `TOUR_STEPS`.
- **Suggested command:** `$impeccable adapt`

### [P2] Dos lenguajes visuales de coachmark
- **Qué:** El tour usa tarjeta `bg-card` + borde + flecha floating-ui; mercadería usa relleno espresso `bg-primary` + flecha de triángulo CSS. Distinto radio, color, sombra y z-index (80–82 vs 9999).
- **Por qué importa:** Consistencia (heurística 4). El usuario que ve ambos percibe dos sistemas, no uno calibrado.
- **Fix:** Unificar en un único componente coachmark/popover (preferible el del tour, alineado a `.surface-elevated`). Definir una escala de z-index nombrada.
- **Suggested command:** `$impeccable extract` (extraer un `<Coachmark>` reusable) → `$impeccable polish`

### [P2] Se filtran errores crudos de Supabase
- **Qué:** `setStep0Error(error.message)` y los fallbacks `rpcError?.message` muestran el string técnico de Supabase tal cual.
- **Por qué importa:** DESIGN.md lo prohíbe explícitamente; es un valle de ansiedad en un momento de setup. El dueño no entiende un error de Postgres.
- **Fix:** Envolver en copy human-readable; loguear el técnico a consola/PostHog.
- **Suggested command:** `$impeccable clarify`

### [P3] El paso 0 atrapa al usuario
- **Qué:** Sin "Completar después" en el paso 0, el dueño no puede cerrar el modal sin cargar nombre + moneda.
- **Por qué importa:** Roza el principio "Trust the operator". El nombre del negocio es legítimamente necesario, pero el encierro total contradice el tono.
- **Fix:** Permitir "Explorar primero" que cierre con `wizard_suppressed` (el negocio ya tiene un nombre por defecto del registro), o pre-llenar y desbloquear el cierre.
- **Suggested command:** `$impeccable harden`

---

## Persona Red Flags

**Dueño primerizo sin experiencia en sistemas (Jordan, target primario):**
- Recibe un modal bloqueante apenas entra: sensación de "esto necesita manual" (justo la anti-reference de PRODUCT.md).
- Si está en tablet, el tour no aparece y queda sin guía.
- Si algo falla en el paso 0, ve un error de Postgres y se traba.

**Cajero/operador delegado (Alex, power user):**
- El onboarding es owner-only, así que no lo ve. OK.
- Pero hereda la inconsistencia de coachmarks cuando el dueño le muestra mercadería vs el resto.

**Dueño apurado en mostrador (persona de proyecto):**
- "Menos de un minuto" que son 4: abandona y se pierde el cierre del tour (permisos, configuración). Peak-end negativo.

---

## Minor Observations

- Checklist: el ítem "tour" pesa igual (1/6) que "primer producto" en la barra de progreso; jerarquía de valor desigual.
- Tour: el spotlight anima propiedades de layout (`transition-all` sobre top/left/width/height) — el skill desaconseja animar layout; posible jank al reposicionar. Considerar `transform`/`clip-path`.
- z-index sin escala nombrada (80/81/82 vs 9999) — definir tokens.
- El gate (`OnboardingTourGate`) y el wizard se montan en lugares distintos (layout vs dashboard); validar que no haya solape visual si ambos aparecieran.

## Questions to Consider

- ¿El primer contacto debería ser un modal, o un dashboard "vivo" con el checklist como guía y cero bloqueo? (Más alineado al principio #1.)
- ¿Qué pasa si el modelo de mercadería (coachmarks contextuales, just-in-time) reemplaza al tour lineal para los módulos nuevos, en vez de sumar pasos?
- ¿Cuál es el "momento de activación" real (primera venta cerrada), y el onboarding lo empuja o lo demora?

---

## Recommended Actions (orden sugerido)

1. **`$impeccable distill`** — recortar el tour a lo troncal y/o realinear el copy "menos de un minuto".
2. **`$impeccable adapt`** — tour real en tablet/mobile (target explícito del producto).
3. **`$impeccable clarify`** — envolver errores crudos de Supabase en el wizard.
4. **`$impeccable extract`** — unificar los dos coachmarks en un `<Coachmark>` y escala de z-index.
5. **`$impeccable harden`** — desbloquear el paso 0 / "explorar primero".
6. **`$impeccable polish`** — pasada final.

> Nota: completar el score con *Assessment B* (`npx impeccable --json src/components/onboarding` + overlay `live`) antes de cerrar los fixes.
