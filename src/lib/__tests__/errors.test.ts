import { describe, it, expect } from 'vitest'
import { translateDbError } from '@/lib/errors'

const FALLBACK = 'Algo salió mal.'

describe('translateDbError', () => {
  it('returns the fallback for an unrecognized message', () => {
    expect(translateDbError('totally unknown failure', FALLBACK)).toBe(FALLBACK)
  })

  describe('permission errors (never leak internal detail)', () => {
    it('maps 403-prefixed RPC errors', () => {
      expect(translateDbError('403: Permisos de inventario insuficientes', FALLBACK)).toBe(
        'No tienes permisos para realizar esta acción. Solicita acceso al dueño.'
      )
    })

    it('maps RLS / permission denied errors', () => {
      expect(translateDbError('new row violates row-level security policy', FALLBACK)).toBe(
        'No tienes permisos para realizar esta acción. Solicita acceso al dueño.'
      )
      expect(translateDbError('permission denied for table products', FALLBACK)).toBe(
        'No tienes permisos para realizar esta acción. Solicita acceso al dueño.'
      )
    })
  })

  describe('session errors', () => {
    it('maps invalid business context', () => {
      expect(translateDbError('Contexto de negocio inválido', FALLBACK)).toBe(
        'Tu sesión expiró o no es válida. Inicia sesión nuevamente.'
      )
    })

    it('maps invalid operator session', () => {
      expect(translateDbError('Sesión de operador inválida', FALLBACK)).toBe(
        'Tu sesión expiró o no es válida. Inicia sesión nuevamente.'
      )
    })
  })

  describe('uniqueness conflicts', () => {
    it('maps duplicate SKU', () => {
      expect(translateDbError('duplicate key value violates unique constraint on sku', FALLBACK)).toBe(
        'Ya existe un producto con ese SKU en este negocio.'
      )
    })

    it('maps duplicate barcode', () => {
      expect(translateDbError('barcode unique violation', FALLBACK)).toBe(
        'Ya existe un producto con ese código de barras.'
      )
    })

    it('maps a generic unique constraint', () => {
      expect(translateDbError('violates unique constraint', FALLBACK)).toBe(
        'Ya existe un registro con esos datos.'
      )
    })
  })

  it('maps insufficient stock', () => {
    expect(translateDbError('Stock insuficiente', FALLBACK)).toBe(
      'Stock insuficiente para completar la operación.'
    )
  })

  it('maps foreign key violations to an associated-records message', () => {
    expect(translateDbError('update violates foreign key constraint', FALLBACK)).toBe(
      'No se puede eliminar porque tiene registros asociados.'
    )
  })

  it('maps not-null violations', () => {
    expect(translateDbError('null value in column "name" violates not-null constraint', FALLBACK)).toBe(
      'Falta un dato obligatorio. Revisa los campos marcados.'
    )
  })

  it('maps check constraint violations', () => {
    expect(translateDbError('new row violates check constraint "price_positive"', FALLBACK)).toBe(
      'Alguno de los valores ingresados no es válido. Revisa precio, costo y stock.'
    )
  })

  it('maps value-too-long errors', () => {
    expect(translateDbError('value too long for type character varying(50)', FALLBACK)).toBe(
      'Un campo supera el largo máximo permitido. Acórtalo e inténtalo de nuevo.'
    )
  })

  it('maps network errors', () => {
    expect(translateDbError('Failed to fetch', FALLBACK)).toBe(
      'No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.'
    )
    expect(translateDbError('network timeout', FALLBACK)).toBe(
      'No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.'
    )
  })

  it('maps storage / payload errors', () => {
    expect(translateDbError('payload too large', FALLBACK)).toBe(
      'No se pudo guardar el archivo. Verifica que pese menos de 2 MB e inténtalo de nuevo.'
    )
  })

  it('is case-insensitive', () => {
    expect(translateDbError('DUPLICATE KEY VALUE', FALLBACK)).toBe(
      'Ya existe un registro con esos datos.'
    )
  })
})
