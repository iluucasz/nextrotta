-- More ways to pay commission. Until now it was always a percentage of the production (or nothing).
-- Some companies pay a fixed amount per service, per hour worked or per day worked, so the mode list grows and the
-- amount is stored next to the percentage: one default for the company, one optional value per technician.
--   per_service  commission = R$ per OS x the number of OS in the month
--   per_hour     commission = R$ per hour x the hours worked in the month
--   per_day      commission = R$ per day x the days with hours worked in the month
-- Whatever the mode, an optional minimum (guaranteed) and maximum (cap) can bound the month's commission; 0 = not used.
-- Every existing company keeps its mode and its percentage, so no folha changes.

ALTER TABLE organization_settings DROP CONSTRAINT IF EXISTS organization_settings_commission_mode_check;
ALTER TABLE organization_settings
  ADD CONSTRAINT organization_settings_commission_mode_check
  CHECK (commission_mode IN ('excess', 'percentage', 'none', 'per_service', 'per_hour', 'per_day'));

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0),
  ADD COLUMN IF NOT EXISTS commission_minimum NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_minimum >= 0),
  ADD COLUMN IF NOT EXISTS commission_maximum NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_maximum >= 0);

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0);
