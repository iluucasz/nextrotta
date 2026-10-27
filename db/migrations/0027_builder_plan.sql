-- "Monte o seu": besides the ready-made packages (Essencial, Pro), a company can assemble its plan —
-- a base with the core product plus the modules it chooses, each module with its own price.
-- This replaces the "Sob medida" plan.

-- 'package' = ready-made plan (its features are fixed); 'builder' = the base to which modules are added.
ALTER TABLE plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'package' CHECK (kind IN ('package', 'builder'));

-- A general feature becomes a module when it has a monthly price; NULL = only sold inside packages.
-- The annual price of a module follows the base plan's (annual price ÷ monthly price).
ALTER TABLE features
  ADD COLUMN module_price     NUMERIC(12, 2) CHECK (module_price >= 0),
  ADD COLUMN module_setup_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (module_setup_fee >= 0);

-- The modules a builder subscription chose, prices frozen at subscribing: [{ "key", "price", "setupFee" }].
-- "price" is per the subscription's cycle and is already inside base_price (base + modules), so every
-- place that computes what the company pays keeps working; this list only says what is unlocked.
ALTER TABLE subscriptions ADD COLUMN modules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The builder's base starts as a copy of Essencial (same price, technicians, limits and features). It is
-- not "visible" (that flag lists packages on the site): the builder is on while the plan isn't archived.
INSERT INTO plans (
  key, name, description, kind, monthly_price, annual_price, extra_technician_price, setup_fee, on_request, featured,
  display_order, visible, included_technicians, max_users, storage_mb, whatsapp_messages_month, porto_runs_month,
  features, ai_monthly_credits, ai_bonus_credits, backup_retention_days
)
SELECT 'montagem', 'Monte o seu', 'Comece pelo essencial e escolha só os módulos de que precisa.', 'builder',
       monthly_price, annual_price, extra_technician_price, setup_fee, FALSE, FALSE,
       3, FALSE, included_technicians, max_users, storage_mb, whatsapp_messages_month, porto_runs_month,
       features, 0, 0, backup_retention_days
FROM plans
WHERE key = 'essencial'
ON CONFLICT (key) DO NOTHING;

-- Starting prices for the modules: what Pro adds over Essencial (R$ 220 a month, R$ 400 of setup) split
-- between them. Suggestions — the owner edits them in the panel.
UPDATE features SET module_price = v.price, module_setup_fee = v.setup
FROM (VALUES
  ('porto', 80, 200),
  ('whatsapp', 35, 60),
  ('finance', 35, 60),
  ('ai', 25, 40),
  ('management_dashboard', 20, 20),
  ('billing_report', 15, 10),
  ('parts', 10, 10)
) AS v (key, price, setup)
WHERE features.key = v.key AND features.scope = 'general';

-- "Sob medida" goes away (nobody is on it): archived instead of deleted.
UPDATE plans
SET visible = FALSE, archived_at = NOW(), updated_at = NOW()
WHERE key = 'sob_medida'
  AND archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.plan_id = plans.id AND s.canceled_at IS NULL);
