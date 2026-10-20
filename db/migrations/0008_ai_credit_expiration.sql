-- The plan's monthly AI quota doesn't accumulate: what's left of it when the month turns expires
-- (an "expiration" entry). Bought and bonus credits never expire.
ALTER TABLE ai_credit_ledger DROP CONSTRAINT ai_credit_ledger_kind_check;
ALTER TABLE ai_credit_ledger
  ADD CONSTRAINT ai_credit_ledger_kind_check
  CHECK (kind IN ('monthly', 'bonus', 'purchase', 'consumption', 'adjustment', 'expiration'));

CREATE UNIQUE INDEX ai_credit_ledger_expiration_idx ON ai_credit_ledger (organization_id, period) WHERE kind = 'expiration';
