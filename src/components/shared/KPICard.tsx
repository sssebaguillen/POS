import { memo, useId, type ReactNode } from 'react'
import { TrendDown, TrendUp } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import PopNumber from '@/components/shared/PopNumber'

interface Trend {
  percent: number
  direction: 'up' | 'down' | 'neutral'
  label: string
  amount?: string   // delta absoluto ya formateado (con signo), se muestra en una segunda línea tenue
}

interface SparkPoint {
  label: string
  value: number
}

interface Props {
  label: string
  value: string
  trend?: Trend
  subtitle?: string
  sparkline?: SparkPoint[]
  children?: ReactNode
  /** Realza la cifra (más grande) para la métrica primaria del dashboard. */
  emphasis?: boolean
  /** Permite que el contenedor controle el span en la grilla (ej. xl:col-span-2). */
  className?: string
}

// Catmull-Rom → curva Bézier suave (línea redondeada, sin segmentos rígidos)
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

// Gráfico de área a ancho completo, anclado al fondo de la card. Se estira para llenar
// el contenedor (preserveAspectRatio="none" + non-scaling-stroke mantiene el trazo nítido).
// Color heredado vía currentColor (lo fija el wrapper según la dirección de la tendencia).
function Sparkline({ points, className }: { points: SparkPoint[]; className?: string }) {
  const gradId = useId()
  const vals = points.map(s => s.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 100
  const H = 40
  const padX = 1
  const padY = 3
  const pts = vals.map((v, i) => ({
    x: padX + (i / (vals.length - 1)) * (W - padX * 2),
    y: H - padY - ((v - min) / range) * (H - padY * 2),
  }))
  const line = smoothPath(pts)
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(2)},${H} L ${pts[0].x.toFixed(2)},${H} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      className={cn('block h-full w-full', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function KPICard({ label, value, trend, subtitle, sparkline, children, emphasis = false, className }: Props) {
  const hasSpark = !!sparkline && sparkline.length > 1
  const sparkColor =
    trend?.direction === 'up'
      ? 'text-success'
      : trend?.direction === 'down'
      ? 'text-destructive'
      : 'text-primary/50'

  return (
    <div className={cn('surface-card p-5 flex flex-col h-full', className)}>
      <p className="text-xs font-medium text-hint mb-2.5">{label}</p>
      <PopNumber
        className={cn(
          'font-display font-bold text-heading leading-none tracking-tight tabular-nums',
          emphasis ? 'text-4xl' : 'text-3xl'
        )}
        value={value}
      />

      {trend ? (
        <div className="mt-2 space-y-0.5">
          <p className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold',
                trend.direction === 'up'
                  ? 'text-success'
                  : trend.direction === 'down'
                  ? 'text-destructive'
                  : 'text-hint'
              )}
            >
              {trend.direction === 'up' && <TrendUp size={13} />}
              {trend.direction === 'down' && <TrendDown size={13} />}
              {trend.percent !== 0
                ? `${trend.direction === 'up' ? '+' : ''}${trend.percent.toFixed(1)}%`
                : '—'}
            </span>
            <span className="text-hint">{trend.label}</span>
          </p>
          {trend.amount && trend.percent !== 0 && (
            <p className="text-[11px] text-hint tabular-nums">{trend.amount}</p>
          )}
        </div>
      ) : subtitle ? (
        <p className="text-xs text-hint mt-2">{subtitle}</p>
      ) : null}

      {hasSpark ? (
        <div className="h-20 mt-4 -mx-1">
          <Sparkline points={sparkline!} className={sparkColor} />
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export default memo(KPICard)
