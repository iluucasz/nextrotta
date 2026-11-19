-- Venda de Peças: fixing what was entered wrong, and undoing a spreadsheet import.
--
-- The stock is still the sum of part_movements, so a correction never edits a past row: it adds a row that points at what it
-- corrects (`corrects_id`). A 'reversal' undoes the row it points at (opposite quantity, a row is reversed at most once); a
-- 'delta' adjusts a sale line that was edited afterwards. The screens that sum movements keep working because the rows net out.

ALTER TABLE part_movements ADD COLUMN IF NOT EXISTS corrects_id UUID REFERENCES part_movements (id);
ALTER TABLE part_movements ADD COLUMN IF NOT EXISTS correction_kind TEXT CHECK (correction_kind IN ('reversal', 'delta'));
ALTER TABLE part_movements ADD COLUMN IF NOT EXISTS import_id UUID;
ALTER TABLE part_movements ADD CONSTRAINT part_movements_correction_check CHECK ((corrects_id IS NULL) = (correction_kind IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS part_movements_reversal_idx ON part_movements (corrects_id) WHERE correction_kind = 'reversal';
CREATE INDEX IF NOT EXISTS part_movements_import_idx ON part_movements (import_id) WHERE import_id IS NOT NULL;

-- "A sale (or its cancellation) moves each part exactly once" is about the original rows: an edited sale adds delta rows.
DROP INDEX IF EXISTS part_movements_sale_idx;
CREATE UNIQUE INDEX part_movements_sale_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale' AND corrects_id IS NULL;
DROP INDEX IF EXISTS part_movements_sale_canceled_idx;
CREATE UNIQUE INDEX part_movements_sale_canceled_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale_canceled' AND corrects_id IS NULL;

-- A remittance undone by the admin (the units went back where they came from).
ALTER TABLE part_transfers ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE part_transfers ADD COLUMN IF NOT EXISTS canceled_by UUID;
ALTER TABLE part_transfers ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- A closed count undone: its movements are reversed and its debt canceled. Losses in the Financeiro only count 'closed' ones.
ALTER TABLE part_inventories DROP CONSTRAINT IF EXISTS part_inventories_status_check;
ALTER TABLE part_inventories ADD CONSTRAINT part_inventories_status_check CHECK (status IN ('open', 'closed', 'canceled', 'reverted'));
ALTER TABLE part_inventories ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;
ALTER TABLE part_inventories ADD COLUMN IF NOT EXISTS reverted_by UUID;
ALTER TABLE part_inventories ADD COLUMN IF NOT EXISTS revert_reason TEXT;

ALTER TABLE part_sales ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE part_sales ADD COLUMN IF NOT EXISTS edited_by UUID;
ALTER TABLE part_sales ADD COLUMN IF NOT EXISTS edit_reason TEXT;

-- Each spreadsheet import, with what the existing parts looked like before it, so it can be undone.
CREATE TABLE part_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  created_count    INTEGER NOT NULL DEFAULT 0,
  updated_count    INTEGER NOT NULL DEFAULT 0,
  units            INTEGER NOT NULL DEFAULT 0,
  -- The parts the import updated, as they were before it.
  previous         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID,
  undone_at        TIMESTAMPTZ,
  undone_by        UUID
);

CREATE INDEX part_imports_organization_idx ON part_imports (organization_id, created_at DESC);

ALTER TABLE parts ADD COLUMN IF NOT EXISTS import_id UUID;
CREATE INDEX IF NOT EXISTS parts_import_idx ON parts (import_id) WHERE import_id IS NOT NULL;
