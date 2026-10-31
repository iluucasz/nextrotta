-- Controle de despesas rebuilt around what a company actually does with its bills: who it is owed to or paid
-- to (supplier), how it is paid (method and the boleto/Pix code to copy), whether it is a fixed or a variable
-- cost, every payment on its own row (partial payments, undoing a payment) and a monthly budget per category.
-- financial_entries keeps its columns and meaning (the dashboard and the assistant read it): paid_amount, status
-- and paid_at stay as a cache of the payments.

ALTER TABLE financial_entries
  ADD COLUMN supplier        TEXT,
  ADD COLUMN payment_method  TEXT,
  ADD COLUMN payment_code    TEXT,
  ADD COLUMN nature          VARCHAR(16) NOT NULL DEFAULT 'variable' CHECK (nature IN ('fixed', 'variable'));

-- What repeats every month is a fixed cost until the company says otherwise.
UPDATE financial_entries SET nature = 'fixed' WHERE is_recurring;

CREATE INDEX financial_entries_org_status_due_idx ON financial_entries (organization_id, status, due_date) WHERE deleted_at IS NULL;

CREATE TABLE financial_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  entry_id         TEXT NOT NULL REFERENCES financial_entries (id),
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_at          DATE NOT NULL,
  method           TEXT,
  note             TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX financial_payments_entry_idx ON financial_payments (entry_id) WHERE deleted_at IS NULL;
CREATE INDEX financial_payments_org_paid_idx ON financial_payments (organization_id, paid_at) WHERE deleted_at IS NULL;

-- Whatever was already marked as paid becomes one payment, so the history starts complete.
INSERT INTO financial_payments (organization_id, entry_id, amount, paid_at)
SELECT organization_id, id, paid_amount, COALESCE(paid_at, due_date)
FROM financial_entries
WHERE paid_amount > 0 AND deleted_at IS NULL;

-- One monthly limit per category (0 = no limit). Never deleted: a limit removed is a limit set to 0.
CREATE TABLE finance_budgets (
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  category         TEXT NOT NULL,
  amount           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID,
  PRIMARY KEY (organization_id, category)
);
