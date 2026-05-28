-- M-3: inventory_movements.created_by was a dead column — no FK, never written
-- by any RPC/trigger, never read by app code (0 of 68 rows non-null). Attribution
-- is handled by created_by_operator (FK → operators, NULL = owner). Drop the
-- redundant column.
ALTER TABLE public.inventory_movements DROP COLUMN created_by;
