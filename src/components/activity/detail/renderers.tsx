'use client'

import type { ReactNode } from 'react'
import type {
  ActivityAction,
  BrandData,
  BulkData,
  CatalogOrderData,
  CategoryData,
  CustomerData,
  CustomerSettlementNew,
  CustomerSettlementOld,
  ExpenseData,
  OperatorData,
  OperatorUpdateData,
  PriceListCreateData,
  PriceListData,
  PriceListUpdateData,
  SaleData,
  SettingsData,
  SupplierData,
  ProductData,
  ProductVariantsData,
} from '@/components/activity/payloads'
import { isActivityAction, readAuditPayload } from '@/components/activity/payloads'
import type { ActivityLogRow, ActivityLookups } from '@/components/activity/types'
import {
  BrandDiff,
  BrandSummary,
  CategoryDiff,
  CategorySummary,
} from '@/components/activity/detail/catalog'
import {
  CustomerDiff,
  CustomerSettlement,
  CustomerSummary,
} from '@/components/activity/detail/customer'
import {
  ExpenseDiff,
  ExpenseSummary,
  SupplierDiff,
  SupplierSummary,
} from '@/components/activity/detail/expense'
import {
  OperatorDiff,
  OperatorSummary,
} from '@/components/activity/detail/operator'
import {
  PriceListDefaultChanged,
  PriceListDiff,
  PriceListSummary,
  SettingsDiff,
  SettingsSlugDiff,
} from '@/components/activity/detail/price-settings'
import {
  BulkProductBrand,
  BulkProductCatalog,
  BulkProductCategory,
  BulkProductDeleted,
  BulkProductStatus,
  ProductDiff,
  ProductSummary,
  ProductVariantsCreated,
  ProductVariantsDiff,
} from '@/components/activity/detail/product'
import {
  SaleDiff,
  SaleSummary,
} from '@/components/activity/detail/sale'
import {
  CatalogOrderCreated,
  CatalogOrderTransition,
} from '@/components/activity/detail/catalog-order'

export interface ActivityDetailRenderProps {
  row: ActivityLogRow
  lookups: ActivityLookups
}

type ActivityRenderer = (props: ActivityDetailRenderProps) => ReactNode

const ACTIVITY_DETAIL_RENDERERS: Record<ActivityAction, ActivityRenderer> = {
  sale_created: ({ row, lookups }) => (
    <SaleSummary data={readAuditPayload<SaleData>(row.new_data)} lookups={lookups} />
  ),
  sale_deleted: ({ row, lookups }) => (
    <SaleSummary data={readAuditPayload<SaleData>(row.old_data)} lookups={lookups} deleted />
  ),
  sale_updated: ({ row, lookups }) => (
    <SaleDiff
      oldData={readAuditPayload<SaleData>(row.old_data)}
      newData={readAuditPayload<SaleData>(row.new_data)}
      lookups={lookups}
    />
  ),
  product_created: ({ row, lookups }) => (
    <ProductSummary data={readAuditPayload<ProductData>(row.new_data)} lookups={lookups} />
  ),
  product_deleted: ({ row, lookups }) => (
    <ProductSummary data={readAuditPayload<ProductData>(row.old_data)} lookups={lookups} deleted />
  ),
  product_updated: ({ row, lookups }) => (
    <ProductDiff
      oldData={readAuditPayload<ProductData>(row.old_data)}
      newData={readAuditPayload<ProductData>(row.new_data)}
      lookups={lookups}
    />
  ),
  product_variants_created: ({ row }) => (
    <ProductVariantsCreated data={readAuditPayload<ProductVariantsData>(row.new_data)} />
  ),
  product_variants_updated: ({ row }) => (
    <ProductVariantsDiff
      oldData={readAuditPayload<ProductVariantsData>(row.old_data)}
      newData={readAuditPayload<ProductVariantsData>(row.new_data)}
    />
  ),
  product_bulk_deleted: ({ row }) => (
    <BulkProductDeleted data={readAuditPayload<BulkData>(row.old_data)} />
  ),
  product_bulk_status: ({ row, lookups }) => (
    <BulkProductStatus
      oldData={readAuditPayload<BulkData>(row.old_data)}
      newData={readAuditPayload<BulkData>(row.new_data)}
      lookups={lookups}
    />
  ),
  product_bulk_catalog: ({ row, lookups }) => (
    <BulkProductCatalog
      oldData={readAuditPayload<BulkData>(row.old_data)}
      newData={readAuditPayload<BulkData>(row.new_data)}
      lookups={lookups}
    />
  ),
  product_bulk_category: ({ row, lookups }) => (
    <BulkProductCategory
      oldData={readAuditPayload<BulkData>(row.old_data)}
      newData={readAuditPayload<BulkData>(row.new_data)}
      lookups={lookups}
    />
  ),
  product_bulk_brand: ({ row, lookups }) => (
    <BulkProductBrand
      oldData={readAuditPayload<BulkData>(row.old_data)}
      newData={readAuditPayload<BulkData>(row.new_data)}
      lookups={lookups}
    />
  ),
  category_created: ({ row }) => (
    <CategorySummary data={readAuditPayload<CategoryData>(row.new_data)} />
  ),
  category_deleted: ({ row }) => (
    <CategorySummary data={readAuditPayload<CategoryData>(row.old_data)} deleted />
  ),
  category_updated: ({ row }) => (
    <CategoryDiff
      oldData={readAuditPayload<CategoryData>(row.old_data)}
      newData={readAuditPayload<CategoryData>(row.new_data)}
    />
  ),
  brand_created: ({ row }) => (
    <BrandSummary data={readAuditPayload<BrandData>(row.new_data)} />
  ),
  brand_deleted: ({ row }) => (
    <BrandSummary data={readAuditPayload<BrandData>(row.old_data)} deleted />
  ),
  brand_updated: ({ row }) => (
    <BrandDiff
      oldData={readAuditPayload<BrandData>(row.old_data)}
      newData={readAuditPayload<BrandData>(row.new_data)}
    />
  ),
  expense_created: ({ row }) => (
    <ExpenseSummary data={readAuditPayload<ExpenseData>(row.new_data)} />
  ),
  expense_deleted: ({ row }) => (
    <ExpenseSummary data={readAuditPayload<ExpenseData>(row.old_data)} deleted />
  ),
  expense_updated: ({ row }) => (
    <ExpenseDiff
      oldData={readAuditPayload<ExpenseData>(row.old_data)}
      newData={readAuditPayload<ExpenseData>(row.new_data)}
    />
  ),
  supplier_created: ({ row }) => (
    <SupplierSummary data={readAuditPayload<SupplierData>(row.new_data)} />
  ),
  supplier_deactivated: ({ row }) => (
    <SupplierSummary data={readAuditPayload<SupplierData>(row.old_data)} deactivated />
  ),
  supplier_updated: ({ row }) => (
    <SupplierDiff
      oldData={readAuditPayload<SupplierData>(row.old_data)}
      newData={readAuditPayload<SupplierData>(row.new_data)}
    />
  ),
  price_list_created: ({ row }) => (
    <PriceListSummary data={readAuditPayload<PriceListCreateData>(row.new_data)?.list ?? null} />
  ),
  price_list_deleted: ({ row }) => (
    <PriceListSummary data={readAuditPayload<PriceListData>(row.old_data)} deleted />
  ),
  price_list_updated: ({ row }) => (
    <PriceListDiff
      oldData={readAuditPayload<PriceListData>(row.old_data)}
      newData={readAuditPayload<PriceListUpdateData>(row.new_data)?.list ?? null}
    />
  ),
  price_list_default_changed: ({ row }) => (
    <PriceListDefaultChanged label={row.entity_label} />
  ),
  settings_updated: ({ row }) => (
    <SettingsDiff
      oldData={readAuditPayload<SettingsData>(row.old_data)}
      newData={readAuditPayload<SettingsData>(row.new_data)}
    />
  ),
  settings_slug_updated: ({ row }) => (
    <SettingsSlugDiff
      oldData={readAuditPayload<{ slug?: string }>(row.old_data)}
      newData={readAuditPayload<{ slug?: string }>(row.new_data)}
    />
  ),
  operator_created: ({ row }) => (
    <OperatorSummary data={readAuditPayload<OperatorData>(row.new_data)} />
  ),
  operator_deleted: ({ row }) => (
    <OperatorSummary data={readAuditPayload<OperatorData>(row.old_data)} deleted />
  ),
  operator_updated: ({ row }) => (
    <OperatorDiff
      oldData={readAuditPayload<OperatorData>(row.old_data)}
      newData={readAuditPayload<OperatorUpdateData>(row.new_data)}
    />
  ),
  customer_created: ({ row }) => (
    <CustomerSummary data={readAuditPayload<CustomerData>(row.new_data)} />
  ),
  customer_updated: ({ row }) => (
    <CustomerDiff
      oldData={readAuditPayload<CustomerData>(row.old_data)}
      newData={readAuditPayload<CustomerData>(row.new_data)}
    />
  ),
  customer_credit_settled: ({ row }) => (
    <CustomerSettlement
      oldData={readAuditPayload<CustomerSettlementOld>(row.old_data)}
      newData={readAuditPayload<CustomerSettlementNew>(row.new_data)}
    />
  ),
  catalog_order_creado: ({ row }) => (
    <CatalogOrderCreated data={readAuditPayload<CatalogOrderData>(row.new_data)} />
  ),
  catalog_order_aceptado: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
  catalog_order_rechazado: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
  catalog_order_cancelado: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
  catalog_order_en_camino: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
  catalog_order_listo_retiro: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
  catalog_order_completado: ({ row }) => (
    <CatalogOrderTransition
      oldData={readAuditPayload<CatalogOrderData>(row.old_data)}
      newData={readAuditPayload<CatalogOrderData>(row.new_data)}
    />
  ),
}

export function renderActivityDetail(props: ActivityDetailRenderProps): ReactNode {
  if (!isActivityAction(props.row.action)) {
    return <p className="text-sm text-hint">Sin datos adicionales.</p>
  }

  const renderer = ACTIVITY_DETAIL_RENDERERS[props.row.action]
  return renderer ? renderer(props) : <p className="text-sm text-hint">Sin datos adicionales.</p>
}
