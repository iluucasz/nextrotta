-- The pay preset the owner picked when creating the company ('fortnightly' or 'monthly'). The
-- provisioning step "settings" applies it to organization_settings; null keeps the defaults.
ALTER TABLE organization_provisioning ADD COLUMN IF NOT EXISTS pay_preset TEXT;
ALTER TABLE organization_provisioning ADD CONSTRAINT organization_provisioning_pay_preset_check
  CHECK (pay_preset IS NULL OR pay_preset IN ('fortnightly', 'monthly'));
