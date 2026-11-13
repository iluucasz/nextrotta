-- The "Personalizado" way of paying commission: a calculation the company builds in steps (lib/commission-formula.ts).
-- The mode joins the allowed values; the steps live in one JSON column, read only when the mode is 'custom'.
ALTER TABLE organization_settings DROP CONSTRAINT IF EXISTS organization_settings_commission_mode_check;
ALTER TABLE organization_settings
  ADD CONSTRAINT organization_settings_commission_mode_check
  CHECK (commission_mode IN ('excess', 'percentage', 'none', 'per_service', 'per_hour', 'per_day', 'custom'));

ALTER TABLE organization_settings
  ADD COLUMN commission_formula JSONB NOT NULL DEFAULT '{"steps": []}'::jsonb;
