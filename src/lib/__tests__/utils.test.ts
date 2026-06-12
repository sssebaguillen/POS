import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('applies conditional object syntax (clsx)', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('merges conflicting Tailwind utilities (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg')
  })
})
