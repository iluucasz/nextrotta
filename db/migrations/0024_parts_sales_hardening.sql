-- Venda de Peças: hardening ported from the production system (October 2026).
--  * company name shown to the customer (payment message, receipt, term) — falls back to the
--    organization's name when empty;
--  * a stock guard that rechecks the units inside the transaction that takes them out, so the same
--    unit can't be sold twice (two taps on "Cobrar", two devices);
--  * unique indexes that make a double cancel or a double write-off of a sale abort its transaction.

ALTER TABLE parts_settings ADD COLUMN company_name TEXT;

-- Used inside the transactions that take units out of a stock (lib/parts/common.ts), right after an
-- advisory lock on that stock. P0409 is turned into an HTTP 409 by the API.
CREATE OR REPLACE FUNCTION parts_require_units(p_organization_id UUID, p_technician_id UUID, p_part_id UUID, p_quantity INT)
RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE
  have INT;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO have
  FROM part_movements
  WHERE organization_id = p_organization_id
    AND part_id = p_part_id
    AND technician_id IS NOT DISTINCT FROM p_technician_id;
  IF have < p_quantity THEN
    RAISE EXCEPTION 'insufficient stock' USING ERRCODE = 'P0409';
  END IF;
END
$fn$;

-- A sale (or its cancellation) moves each part exactly once.
CREATE UNIQUE INDEX part_movements_sale_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale';
CREATE UNIQUE INDEX part_movements_sale_canceled_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale_canceled';
CREATE UNIQUE INDEX part_account_entries_sale_canceled_idx ON part_account_entries (sale_id) WHERE kind = 'sale_canceled';
