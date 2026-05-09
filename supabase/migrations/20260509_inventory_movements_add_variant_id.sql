-- 1. Add variant_id column and index
ALTER TABLE inventory_movements
ADD COLUMN variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_movements_variant_id
ON inventory_movements(variant_id) WHERE variant_id IS NOT NULL;

-- 2. Update trigger to populate variant_id
CREATE OR REPLACE FUNCTION public.update_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.variant_id IS NOT NULL THEN
    UPDATE product_variants
    SET stock = stock - NEW.quantity
    WHERE id = NEW.variant_id;

    UPDATE products
    SET sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  ELSE
    UPDATE products
    SET
      stock       = stock - NEW.quantity,
      sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  END IF;

  INSERT INTO inventory_movements (
    business_id, product_id, variant_id, type, quantity, reason, reference_id
  )
  SELECT s.business_id, NEW.product_id, NEW.variant_id, 'sale', -NEW.quantity, 'Venta', NEW.sale_id
  FROM sales s
  WHERE s.id = NEW.sale_id;

  RETURN NEW;
END;
$function$;
