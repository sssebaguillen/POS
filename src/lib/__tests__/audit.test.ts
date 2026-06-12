import { describe, it, expect } from 'vitest'
import { getAuditActionTone, getAuditActionLabel, AUDIT_ACTION_LABELS } from '@/lib/audit'

describe('getAuditActionTone', () => {
  it('classifies *_created actions as "created"', () => {
    expect(getAuditActionTone('product_created')).toBe('created')
    expect(getAuditActionTone('sale_created')).toBe('created')
    expect(getAuditActionTone('operator_created')).toBe('created')
  })

  it('classifies *_updated actions as "updated"', () => {
    expect(getAuditActionTone('product_updated')).toBe('updated')
    expect(getAuditActionTone('settings_updated')).toBe('updated')
  })

  it('classifies *_deleted actions as "deleted"', () => {
    expect(getAuditActionTone('product_deleted')).toBe('deleted')
    expect(getAuditActionTone('sale_deleted')).toBe('deleted')
  })

  it('classifies any bulk action as "bulk" (takes precedence)', () => {
    expect(getAuditActionTone('product_bulk_deleted')).toBe('bulk')
    expect(getAuditActionTone('product_bulk_status')).toBe('bulk')
    expect(getAuditActionTone('product_bulk_category')).toBe('bulk')
  })

  describe('catalog_order actions', () => {
    it('treats creado as "created"', () => {
      expect(getAuditActionTone('catalog_order_creado')).toBe('created')
    })

    it('treats rechazado and cancelado as "deleted"', () => {
      expect(getAuditActionTone('catalog_order_rechazado')).toBe('deleted')
      expect(getAuditActionTone('catalog_order_cancelado')).toBe('deleted')
    })

    it('treats other catalog_order transitions as "updated"', () => {
      expect(getAuditActionTone('catalog_order_aceptado')).toBe('updated')
      expect(getAuditActionTone('catalog_order_en_camino')).toBe('updated')
      expect(getAuditActionTone('catalog_order_completado')).toBe('updated')
    })
  })

  it('defaults unknown actions to "updated"', () => {
    expect(getAuditActionTone('something_weird')).toBe('updated')
  })
})

describe('getAuditActionLabel', () => {
  it('returns the Spanish label for known actions', () => {
    expect(getAuditActionLabel('sale_created')).toBe('Venta creada')
    expect(getAuditActionLabel('price_list_default_changed')).toBe('Lista de precios predeterminada')
  })

  it('falls back to the raw action string when unknown', () => {
    expect(getAuditActionLabel('mystery_action')).toBe('mystery_action')
  })

  it('has a label for every documented action key', () => {
    for (const key of Object.keys(AUDIT_ACTION_LABELS)) {
      expect(getAuditActionLabel(key)).toBe(AUDIT_ACTION_LABELS[key])
    }
  })
})
