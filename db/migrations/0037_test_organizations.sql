-- Test organizations ("empresa de teste"): the owner's own accounts (demos, homologation, training).
-- Like lifetime ones they are never charged and stay out of the revenue figures, and what they consume
-- still counts as cost; on top of that they don't count as customers (new, canceled, by status).
--   is_test / test_since / test_reason   flag, when and why (audited)
--   unbilled                             lifetime OR is_test: the one column billing and revenue read
-- An organization is lifetime or test, never both.

ALTER TABLE organizations
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN test_since TIMESTAMPTZ,
  ADD COLUMN test_reason TEXT,
  ADD CONSTRAINT organizations_lifetime_or_test CHECK (NOT (lifetime AND is_test)),
  ADD COLUMN unbilled BOOLEAN GENERATED ALWAYS AS (lifetime OR is_test) STORED;
