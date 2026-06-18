# Spec COMPLETO — Migración de iconos Lucide → Phosphor (toda la app)

> **Estado:** listo para el agente automático. Mapeo **100% verificado** contra la lista canónica de Phosphor (`@phosphor-icons/core`, 1512 iconos) el 2026-06-18.
> **Contexto de diseño:** seguir las reglas del `README.md` de esta carpeta (peso `regular` por defecto, `fill` solo para activo/seleccionado, quitar `strokeWidth`, conservar `size`/`className`, color vía `currentColor`).
> **Por qué este doc:** el `README.md` original solo mapeaba el set de `/dashboard` (28 iconos). La app usa **127 nombres distintos** en **108 archivos**. Acá está el mapeo completo + los casos especiales que el handoff no cubría.

---

## 0. Reglas de ejecución (protocolo del agente)

- Swap **en el lugar** (in-place), como ya hace el código: reemplazar `from 'lucide-react'` por `from '@phosphor-icons/react'` y cambiar los nombres según la tabla. **NO** se introduce un módulo central nuevo (decisión de diseño: mantener el patrón actual).
- **Un PR por área** (ver §4). NO un PR gigante.
- **`tsc` + `lint` + `build` verdes** en cada PR. `tsc` es además la red de seguridad: si algún nombre Phosphor no existiera (drift de versión), el build falla → ahí flaguear ese icono puntual en "⚠️ Preguntas" y seguir con el resto.
- **Camino del dinero (POS, carrito, pagos, cash-sessions):** va en un PR APARTE y final, marcado **`⚠️ MONEY-PATH: requiere E2E + QA visual del dueño antes de mergear`**. El swap es inerte (solo iconos, cero lógica), pero la regla 5 se respeta: el dueño valida E2E y lo mergea. NO mezclar money-path con áreas normales.
- **QA visual lo hace el dueño** (el agente no ve). Mantener `size`/`className` exactamente como están para no alterar el layout.
- Si aparece un nombre Lucide **fuera de esta tabla** (código nuevo desde 2026-06-18): NO adivinar el match → **flaguear** en "⚠️ Preguntas".

---

## 1. Pasos

1. `npm install @phosphor-icons/react`
2. Por área: reemplazar imports + nombres según §2. Preservar nombres locales aliasados con `as` (ver §3).
3. **NO** quitar `lucide-react` de `package.json` hasta que `grep -rn "lucide-react" src/` devuelva **vacío** (o sea, después de mergear también el PR money-path). Es el último paso (checklist §5).
4. Verificar por PR: `npm run lint` + `npm run build`.

---

## 2. Tabla de mapeo completa (Lucide → Phosphor, peso regular)

> 126 glifos, todos validados contra Phosphor. (`LucideProps` es un *type*, ver §3.)

| Lucide | Phosphor |
|---|---|
| `ShoppingCart` | `ShoppingCart` |
| `Users` | `Users` |
| `User` | `User` |
| `Inbox` | `Tray` |
| `BarChart2` | `ChartBar` |
| `LineChart` | `ChartLine` |
| `History` | `ClockCounterClockwise` |
| `Package` | `Package` |
| `ClipboardList` | `ClipboardText` |
| `BadgePercent` | `SealPercent` |
| `Receipt` | `Receipt` |
| `Vault` | `Vault` |
| `Settings` | `Gear` |
| `Globe` | `Globe` |
| `Search` | `MagnifyingGlass` |
| `ScanBarcode` | `Barcode` |
| `ChevronDown` | `CaretDown` |
| `Check` | `Check` |
| `Plus` | `Plus` |
| `Minus` | `Minus` |
| `Trash2` | `Trash` |
| `Percent` | `Percent` |
| `PenLine` | `PencilSimple` |
| `Moon` | `Moon` |
| `PanelLeftClose` | `SidebarSimple` |
| `X` | `X` |
| `TrendingUp` | `TrendUp` |
| `TrendingDown` | `TrendDown` |
| `AlertCircle` | `WarningCircle` |
| `AlertTriangle` | `Warning` |
| `Apple` | `Orange` |
| `ArrowDown` | `ArrowDown` |
| `ArrowDownToLine` | `ArrowLineDown` |
| `ArrowLeft` | `ArrowLeft` |
| `ArrowRight` | `ArrowRight` |
| `ArrowUp` | `ArrowUp` |
| `ArrowUpDown` | `ArrowsDownUp` |
| `ArrowUpRight` | `ArrowUpRight` |
| `Baby` | `Baby` |
| `Beef` | `Cow` |
| `Beer` | `BeerBottle` |
| `Bike` | `Bicycle` |
| `Book` | `Book` |
| `Building2` | `Buildings` |
| `CalendarIcon` | `Calendar` |
| `Car` | `Car` |
| `Carrot` | `Carrot` |
| `CheckCircle2` | `CheckCircle` |
| `ChevronLeft` | `CaretLeft` |
| `ChevronRight` | `CaretRight` |
| `ChevronUp` | `CaretUp` |
| `Coffee` | `Coffee` |
| `Compass` | `Compass` |
| `Cookie` | `Cookie` |
| `CreditCard` | `CreditCard` |
| `DollarSign` | `CurrencyDollar` |
| `Download` | `DownloadSimple` |
| `Dumbbell` | `Barbell` |
| `ExternalLink` | `ArrowSquareOut` |
| `FileSpreadsheet` | `FileXls` |
| `FileText` | `FileText` |
| `Flower2` | `Flower` |
| `Folder` | `Folder` |
| `Gamepad2` | `GameController` |
| `Gift` | `Gift` |
| `GlobeLock` | `GlobeSimple` |
| `GraduationCap` | `GraduationCap` |
| `Hash` | `Hash` |
| `Home` | `House` |
| `Image` | `Image` |
| `ImageIcon` | `Image` |
| `Info` | `Info` |
| `KeyRound` | `Key` |
| `Layers` | `Stack` |
| `LayoutGrid` | `GridFour` |
| `LayoutList` | `ListBullets` |
| `Lightbulb` | `Lightbulb` |
| `Loader2` | `CircleNotch` |
| `Lock` | `Lock` |
| `LogOut` | `SignOut` |
| `Mail` | `Envelope` |
| `MailCheck` | `EnvelopeOpen` |
| `MapPin` | `MapPin` |
| `Menu` | `List` |
| `MessageCircle` | `ChatCircle` |
| `MessageSquarePlus` | `ChatCircleDots` |
| `Milk` | `Drop` |
| `MoreVertical` | `DotsThreeVertical` |
| `Music` | `MusicNotes` |
| `PackageCheck` | `Package` |
| `PackageX` | `Package` |
| `PanelLeftOpen` | `SidebarSimple` |
| `Paperclip` | `Paperclip` |
| `PawPrint` | `PawPrint` |
| `Pencil` | `PencilSimple` |
| `Phone` | `Phone` |
| `Pill` | `Pill` |
| `Power` | `Power` |
| `PowerOff` | `Power` |
| `Printer` | `Printer` |
| `RefreshCw` | `ArrowsClockwise` |
| `Sandwich` | `Hamburger` |
| `Scissors` | `Scissors` |
| `SearchX` | `MagnifyingGlassMinus` |
| `Send` | `PaperPlaneTilt` |
| `Share2` | `ShareNetwork` |
| `Shirt` | `TShirt` |
| `ShoppingBag` | `ShoppingBag` |
| `SlidersHorizontal` | `FadersHorizontal` |
| `Sparkles` | `Sparkle` |
| `Stamp` | `Stamp` |
| `Star` | `Star` |
| `Stethoscope` | `Stethoscope` |
| `Sun` | `Sun` |
| `Tag` | `Tag` |
| `Truck` | `Truck` |
| `Upload` | `UploadSimple` |
| `UserCircle` | `UserCircle` |
| `UserCog` | `UserGear` |
| `UserRound` | `User` |
| `Volume2` | `SpeakerHigh` |
| `VolumeX` | `SpeakerSlash` |
| `Wine` | `Wine` |
| `Wrench` | `Wrench` |
| `XIcon` | `X` |
| `Zap` | `Lightning` |

### Sustituciones donde Phosphor no tiene el glifo exacto (decididas, no flaguear)
Phosphor no tiene equivalente literal de estos; sustituto ya elegido — **no re-decidir, usar el de la tabla**:
- `Apple` → `Orange` (Phosphor no tiene manzana; fruta redonda más cercana). No está en datos reales, solo en el picker.
- `Beef` → `Cow`, `Milk` → `Drop`, `Sandwich` → `Hamburger` (food del picker).
- `MailCheck` → `EnvelopeOpen` (se pierde el ✓; aceptable).
- `PackageCheck` y `PackageX` → ambos `Package` (Phosphor no tiene las variantes ✓/✗; el contexto — color/texto — porta el significado). Si en QA visual se ve que hace falta distinguir, el dueño lo refina post-merge.

---

## 3. Casos especiales (NO son swaps triviales)

### 3.1 `LucideProps` (es un *type*, no un glifo)
`src/components/inventory/CategoryIconPreview.tsx:9` hace `import type { LucideProps } from 'lucide-react'`.
→ Reemplazar por `import type { IconProps } from '@phosphor-icons/react'` y cambiar el uso `LucideProps` → `IconProps`. (Si `grep -rn "LucideProps\|LucideIcon" src/` encuentra más usos, mismo criterio.)

### 3.2 Imports aliasados → preservar el nombre local con `as`
Para no tocar el JSX, conservar el identificador local:
- `CalendarIcon` → `import { Calendar as CalendarIcon } from '@phosphor-icons/react'`
- `ImageIcon` → `import { Image as ImageIcon } from '@phosphor-icons/react'`
- `XIcon` → `import { X as XIcon } from '@phosphor-icons/react'`
(Si un archivo ya importa `Image` **y** `ImageIcon`, dejar `Image` directo + `Image as ImageIcon` no se puede duplicar → en ese caso unificar a `Image` y ajustar los usos. Verificar por archivo.)

### 3.3 `Loader2` → `CircleNotch` (spinner)
Suele venir con `className="animate-spin"`. **Conservar la className** — `CircleNotch` gira igual con `animate-spin`.

### 3.4 ⚠️ `ICON_MAP` de categorías — EL ARCHIVO MÁS DELICADO
`src/components/inventory/CategoryIconPreview.tsx` tiene un `ICON_MAP` donde **las CLAVES string están persistidas en la DB** (`categories.icon`). **Las claves NO se pueden cambiar** o se rompen los iconos de categorías ya creadas. (Datos reales hoy: solo `Coffee`, `Cookie`, `Shirt`, `Tag`, `Zap` + emojis; los emojis van por la rama `isEmoji`, no se tocan. Pero el picker ofrece las 32 → todas deben mapear bien.)

**Regla:** mantener cada CLAVE idéntica; cambiar solo el COMPONENTE al que apunta. El `ICON_MAP` queda exactamente así:

```tsx
import {
  ShoppingCart, Tag, Package, Orange, Coffee, Cow, Drop, Carrot,
  Cookie, Hamburger, Wine, BeerBottle, Pill, TShirt, Scissors, Wrench, Lightning, Sparkle,
  PawPrint, Baby, Book, MusicNotes, GameController, Barbell, Flower, House, Car, Bicycle,
  Stethoscope, GraduationCap, Gift, Star,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'

const ICON_MAP = {
  ShoppingCart, Tag, Package, Apple: Orange, Coffee, Beef: Cow, Milk: Drop, Carrot,
  Cookie, Sandwich: Hamburger, Wine, Beer: BeerBottle, Pill, Shirt: TShirt, Scissors, Wrench, Zap: Lightning, Sparkles: Sparkle,
  PawPrint, Baby, Book, Music: MusicNotes, Gamepad2: GameController, Dumbbell: Barbell, Flower2: Flower, Home: House, Car, Bike: Bicycle,
  Stethoscope, GraduationCap, Gift, Star,
} as const
```

(Notar las claves preservadas con `:` — `Apple: Orange`, `Beef: Cow`, `Milk: Drop`, `Sandwich: Hamburger`, `Beer: BeerBottle`, `Shirt: TShirt`, `Zap: Lightning`, `Sparkles: Sparkle`, `Music: MusicNotes`, `Gamepad2: GameController`, `Dumbbell: Barbell`, `Flower2: Flower`, `Home: House`, `Bike: Bicycle`.) `DynamicIcon` y el fallback a `Tag` quedan igual; cambiar el tipo `LucideProps` → `IconProps`.

### 3.5 Estados `fill` (activo/seleccionado)
Por defecto TODO va en `regular` (sin prop `weight`). Aplicar `weight="fill"` (color `text-primary`) **solo** donde el handoff lo indica explícitamente: **el item activo del sidebar**. Para cualquier otro "¿esto es estado activo/énfasis?" que no sea obvio → NO adivinar, dejarlo `regular` y, si parece candidato, flaguear en "⚠️ Preguntas". (El refinamiento de estados `fill` puede ser un pase posterior con el dueño.)

---

## 4. Batching de PRs por área (un PR cada uno)

| PR | Área (archivos) | Money-path |
|----|----|----|
| 1 | `sidebar.tsx`, `components/shared/*`, `components/ui/*`, `app/**` layout | no |
| 2 | `components/inventory/*` (incluye `CategoryIconPreview.tsx` — §3.4) | no |
| 3 | `components/stats/*`, `components/dashboard/*` | no |
| 4 | `components/catalog/*` | no |
| 5 | `components/orders/*`, `expenses/*`, `customers/*`, `settings/*`, `operator/*`, `activity/*`, `price-lists/*`, `promotions/*`, `auth/*`, `profile/*`, `operator-profile/*`, `onboarding/*` | no |
| 6 | `components/pos/*`, `cash-sessions/*` | **SÍ — PR aparte, `⚠️ MONEY-PATH` para E2E + QA visual del dueño** |

Ajustar el corte si un archivo cae en varias áreas; lo importante: **money-path aislado** y PRs revisables. Confirmar con `grep -rln "lucide-react" src/components/<area>` qué archivos toca cada PR.

---

## 5. Checklist de cierre (último paso, tras mergear TODO incl. money-path)
- [ ] `grep -rn "lucide-react" src/` → **vacío**.
- [ ] Quitar `lucide-react` de `package.json` (dependencies) + `npm install` para limpiar lock.
- [ ] `npm run build` verde.
- [ ] QA visual del dueño: nav, POS (Vender), Resumen, Inventario (iconos de categoría), Catálogo público.

## Criterios de aceptación (del README original)
- `grep -rn "lucide-react" src/` no devuelve nada.
- `lucide-react` fuera de `package.json`.
- Build + typecheck limpios.
- Item activo del sidebar y estados de énfasis con `weight="fill"` en `--primary`; el resto `regular`.
- Spot-check visual: nav, POS, Resumen, iconos de categoría se ven con el mismo `size` que antes.
