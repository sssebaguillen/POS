import { describe, it, expect } from 'vitest'
import {
  ACCENT_CHIP,
  ACCENT_DOT,
  ACCENT_BAR,
  ACCENT_FILL,
  type AccentTone,
} from '@/lib/accent-colors'

const TONES: AccentTone[] = [
  'blue', 'sky', 'indigo', 'violet', 'amber', 'orange',
  'emerald', 'teal', 'red', 'rose', 'muted',
]

describe('accent color maps', () => {
  it.each(['ACCENT_CHIP', 'ACCENT_DOT', 'ACCENT_BAR', 'ACCENT_FILL'])(
    '%s has a non-empty class for every tone',
    (mapName) => {
      const map = { ACCENT_CHIP, ACCENT_DOT, ACCENT_BAR, ACCENT_FILL }[mapName] as Record<AccentTone, string>
      for (const tone of TONES) {
        expect(map[tone]).toBeTruthy()
        expect(typeof map[tone]).toBe('string')
      }
    }
  )

  it('every map covers exactly the known tones (no missing/extra keys)', () => {
    for (const map of [ACCENT_CHIP, ACCENT_DOT, ACCENT_BAR, ACCENT_FILL]) {
      expect(Object.keys(map).sort()).toEqual([...TONES].sort())
    }
  })

  it('ACCENT_DOT uses solid bg-*-500 utilities', () => {
    expect(ACCENT_DOT.blue).toBe('bg-blue-500')
    expect(ACCENT_DOT.emerald).toBe('bg-emerald-500')
  })
})
