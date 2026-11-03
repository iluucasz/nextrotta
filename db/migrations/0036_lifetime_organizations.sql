-- Lifetime organizations ("vitalício"): they use the platform without paying. They stay out of the
-- revenue figures (MRR, charges, forecast) and are never charged or suspended for nonpayment, but
-- what they consume still counts as cost (Operação → Gastos, the organization's Custos tab).
--   lifetime         flag; the owner turns it on and off (audited)
--   lifetime_since   when it was turned on
--   lifetime_reason  why (a partner, a trade, a pilot...)

ALTER TABLE organizations
  ADD COLUMN lifetime BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN lifetime_since TIMESTAMPTZ,
  ADD COLUMN lifetime_reason TEXT;
