-- New price list (16/11/2026, owner's decision):
--  * "Horas e banco de horas" leaves the base: it stops being a core feature and becomes a module of
--    "Monte o seu" (Pro keeps it).
--  * Essencial: R$ 249,99/month, 4 technicians included, R$ 19,99 per extra technician, setup R$ 799 in up to 2x.
--  * Pro: R$ 549,99/month, setup R$ 999 in up to 3x (technicians unchanged).
--  * "Monte o seu" starts from the Essencial base (same price, technicians and setup) and every module costs more.
--  * Order on the site: Monte o seu, Essencial, Pro (Pro is the highlighted one).
-- Annual prices keep "2 months free" (10 x monthly). Existing subscriptions keep the prices copied
-- when they subscribed; only new subscriptions and plan features follow these rows.

-- Maximum number of instalments of the setup fee (1 = paid at once).
ALTER TABLE plans ADD COLUMN setup_installments INTEGER NOT NULL DEFAULT 1 CHECK (setup_installments BETWEEN 1 AND 12);

UPDATE plans SET
  monthly_price = 249.99,
  annual_price = 2499.90,
  extra_technician_price = 19.99,
  included_technicians = 4,
  setup_fee = 799,
  setup_installments = 2,
  description = 'Organize técnicos, OS, escala e folha num só lugar.',
  features = array_remove(features, 'hours'),
  featured = FALSE,
  display_order = 2,
  updated_at = NOW()
WHERE key = 'essencial';

UPDATE plans SET
  monthly_price = 549.99,
  annual_price = 5499.90,
  setup_fee = 999,
  setup_installments = 3,
  featured = TRUE,
  display_order = 3,
  updated_at = NOW()
WHERE key = 'pro';

-- The builder's base follows Essencial.
UPDATE plans SET
  monthly_price = 249.99,
  annual_price = 2499.90,
  extra_technician_price = 19.99,
  included_technicians = 4,
  setup_fee = 799,
  setup_installments = 2,
  features = array_remove(features, 'hours'),
  featured = FALSE,
  display_order = 1,
  updated_at = NOW()
WHERE key = 'montagem';

-- Module prices (monthly) and setup fees. Hours has no price from the owner yet: a suggestion to adjust in the panel.
UPDATE features SET module_price = v.price, module_setup_fee = v.setup, updated_at = NOW()
FROM (VALUES
  ('whatsapp', 14.99, 10),
  ('parts', 49.99, 60),
  ('porto', 89.99, 200),
  ('ai', 49.99, 60),
  ('finance', 29.99, 40),
  ('management_dashboard', 29.99, 20),
  ('billing_report', 14.99, 10),
  ('hours', 29.99, 20)
) AS v (key, price, setup)
WHERE features.key = v.key AND features.scope = 'general';
