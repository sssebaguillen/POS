export type AccentTone =
  | 'blue'
  | 'sky'
  | 'indigo'
  | 'violet'
  | 'amber'
  | 'orange'
  | 'emerald'
  | 'teal'
  | 'red'
  | 'rose'
  | 'muted'

export const ACCENT_CHIP: Record<AccentTone, string> = {
  blue:    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  sky:     'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
  violet:  'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
  amber:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  orange:  'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  teal:    'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30',
  red:     'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  rose:    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  muted:   'bg-muted text-muted-foreground border-border',
}

export const ACCENT_DOT: Record<AccentTone, string> = {
  blue:    'bg-blue-500',
  sky:     'bg-sky-500',
  indigo:  'bg-indigo-500',
  violet:  'bg-violet-500',
  amber:   'bg-amber-500',
  orange:  'bg-orange-500',
  emerald: 'bg-emerald-500',
  teal:    'bg-teal-500',
  red:     'bg-red-500',
  rose:    'bg-rose-500',
  muted:   'bg-hint',
}

export const ACCENT_BAR: Record<AccentTone, string> = {
  blue:    'bg-blue-500/30 dark:bg-blue-400/30',
  sky:     'bg-sky-500/30 dark:bg-sky-400/30',
  indigo:  'bg-indigo-500/30 dark:bg-indigo-400/30',
  violet:  'bg-violet-500/30 dark:bg-violet-400/30',
  amber:   'bg-amber-500/30 dark:bg-amber-400/30',
  orange:  'bg-orange-500/30 dark:bg-orange-400/30',
  emerald: 'bg-emerald-500/30 dark:bg-emerald-400/30',
  teal:    'bg-teal-500/30 dark:bg-teal-400/30',
  red:     'bg-red-500/30 dark:bg-red-400/30',
  rose:    'bg-rose-500/30 dark:bg-rose-400/30',
  muted:   'bg-hint/30',
}

// Relleno intermedio (/60) — más presencia que ACCENT_BAR, sin la saturación plena de ACCENT_DOT.
export const ACCENT_FILL: Record<AccentTone, string> = {
  blue:    'bg-blue-500/60 dark:bg-blue-400/60',
  sky:     'bg-sky-500/60 dark:bg-sky-400/60',
  indigo:  'bg-indigo-500/60 dark:bg-indigo-400/60',
  violet:  'bg-violet-500/60 dark:bg-violet-400/60',
  amber:   'bg-amber-500/60 dark:bg-amber-400/60',
  orange:  'bg-orange-500/60 dark:bg-orange-400/60',
  emerald: 'bg-emerald-500/60 dark:bg-emerald-400/60',
  teal:    'bg-teal-500/60 dark:bg-teal-400/60',
  red:     'bg-red-500/60 dark:bg-red-400/60',
  rose:    'bg-rose-500/60 dark:bg-rose-400/60',
  muted:   'bg-hint/60',
}
