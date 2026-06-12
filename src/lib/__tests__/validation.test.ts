import { describe, it, expect } from 'vitest'
import { BUSINESS_SLUG_REGEX, validateImageUrl } from '@/lib/validation'

describe('BUSINESS_SLUG_REGEX', () => {
  it('accepts valid slugs', () => {
    expect(BUSINESS_SLUG_REGEX.test('mi-negocio')).toBe(true)
    expect(BUSINESS_SLUG_REGEX.test('kiosco123')).toBe(true)
    expect(BUSINESS_SLUG_REGEX.test('a1b')).toBe(true)
    expect(BUSINESS_SLUG_REGEX.test('almacen-don-pepe')).toBe(true)
  })

  it('rejects slugs shorter than 3 characters', () => {
    expect(BUSINESS_SLUG_REGEX.test('ab')).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('a')).toBe(false)
  })

  it('rejects uppercase letters', () => {
    expect(BUSINESS_SLUG_REGEX.test('MiNegocio')).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('ABC')).toBe(false)
  })

  it('rejects leading or trailing hyphens', () => {
    expect(BUSINESS_SLUG_REGEX.test('-negocio')).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('negocio-')).toBe(false)
  })

  it('rejects spaces and special characters', () => {
    expect(BUSINESS_SLUG_REGEX.test('mi negocio')).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('negocio_1')).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('negocio!')).toBe(false)
  })

  it('rejects slugs longer than 50 characters', () => {
    expect(BUSINESS_SLUG_REGEX.test('a'.repeat(51))).toBe(false)
    expect(BUSINESS_SLUG_REGEX.test('a'.repeat(50))).toBe(true)
  })
})

describe('validateImageUrl', () => {
  it('returns empty string for empty input (no error)', () => {
    expect(validateImageUrl('')).toBe('')
  })

  it('accepts valid https URLs', () => {
    expect(validateImageUrl('https://example.com/image.png')).toBe('')
    expect(validateImageUrl('https://cdn.site.com/a/b/c.jpg')).toBe('')
  })

  it('blocks data: URIs (XSS / payload injection vector)', () => {
    expect(validateImageUrl('data:image/png;base64,AAAA')).toBe('URL no permitida')
  })

  it('blocks javascript: URIs', () => {
    expect(validateImageUrl('javascript:alert(1)')).toBe('URL no permitida')
  })

  it('blocks file: URIs', () => {
    expect(validateImageUrl('file:///etc/passwd')).toBe('URL no permitida')
  })

  it('blocks blob: URIs', () => {
    expect(validateImageUrl('blob:https://example.com/uuid')).toBe('URL no permitida')
  })

  it('rejects http:// (non-secure) URLs', () => {
    expect(validateImageUrl('http://example.com/image.png')).toBe('La URL debe comenzar con https://')
  })

  it('rejects relative or scheme-less URLs', () => {
    expect(validateImageUrl('example.com/image.png')).toBe('La URL debe comenzar con https://')
    expect(validateImageUrl('/images/local.png')).toBe('La URL debe comenzar con https://')
  })
})
