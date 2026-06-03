// P12 (paso 6) — preferencia de sonido (opt-in) + chime suave para sugerencias nuevas.
// Opt-in: apagado por defecto; el dueño lo activa desde el toggle del popover.

export const INSIGHT_SOUND_KEY = 'ai-insights-sound'

export function isInsightSoundOn(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(INSIGHT_SOUND_KEY) === 'true'
}

export function setInsightSoundOn(on: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(INSIGHT_SOUND_KEY, on ? 'true' : 'false')
}

// Chime deliberadamente más suave y grave que el beep de pedidos (no urge; es un susurro).
// Dos notas ascendentes muy tenues. Tolera fallos de autoplay sin romper.
export function playInsightChime(): void {
  if (typeof window === 'undefined') return
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const now = ctx.currentTime
    const notes = [
      { freq: 587.33, at: 0 },     // re
      { freq: 783.99, at: 0.12 },  // sol
    ]
    for (const note of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = note.freq
      const start = now + note.at
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.5)
    }
    window.setTimeout(() => ctx.close().catch(() => {}), 900)
  } catch {
    // ignore audio errors (autoplay policies, etc.)
  }
}
