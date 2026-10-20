-- Plans (edited by the platform owner, never hardcoded), each organization's subscription, the
-- mirror of its charges in the payment gateway (Asaas) and the gateway's webhook log.

CREATE TABLE plans (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                     TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  description             TEXT,
  monthly_price           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  annual_price            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (annual_price >= 0),
  extra_technician_price  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (extra_technician_price >= 0),
  setup_fee               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  -- "Sob consulta": no public price; the site sends people to the contact form.
  on_request              BOOLEAN NOT NULL DEFAULT FALSE,
  featured                BOOLEAN NOT NULL DEFAULT FALSE,
  display_order           INTEGER NOT NULL DEFAULT 0,
  visible                 BOOLEAN NOT NULL DEFAULT TRUE,
  included_technicians    INTEGER NOT NULL DEFAULT 0 CHECK (included_technicians >= 0),
  -- Limits: NULL means unlimited.
  max_users               INTEGER CHECK (max_users >= 0),
  storage_mb              INTEGER CHECK (storage_mb >= 0),
  whatsapp_messages_month INTEGER CHECK (whatsapp_messages_month >= 0),
  porto_runs_month        INTEGER CHECK (porto_runs_month >= 0),
  -- General feature keys (see lib/plans.ts) this plan unlocks.
  features                TEXT[] NOT NULL DEFAULT '{}',
  ai_monthly_credits      INTEGER NOT NULL DEFAULT 0 CHECK (ai_monthly_credits >= 0),
  ai_bonus_credits        INTEGER NOT NULL DEFAULT 0 CHECK (ai_bonus_credits >= 0),
  -- Daily backup retention in days; NULL means unlimited.
  backup_retention_days   INTEGER CHECK (backup_retention_days > 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at             TIMESTAMPTZ
);

INSERT INTO plans (
  key, name, description, monthly_price, annual_price, extra_technician_price, setup_fee, on_request, featured,
  display_order, included_technicians, storage_mb, whatsapp_messages_month, features, ai_monthly_credits,
  ai_bonus_credits, backup_retention_days
) VALUES
  ('essencial', 'Essencial', 'Organize técnicos, OS, horas, escala e folha num só lugar.',
   197, 1970, 29, 600, FALSE, FALSE, 1, 5, 2048, NULL,
   ARRAY['technicians','services','service_import','hours','schedule','payroll','library'], 0, 0, 90),
  ('pro', 'Pro', 'Tudo do Essencial com automação Porto, WhatsApp, financeiro e IA.',
   397, 3970, 35, 1000, FALSE, TRUE, 2, 10, 10240, 3000,
   ARRAY['technicians','services','service_import','hours','schedule','payroll','library',
         'porto','whatsapp','finance','billing_report','management_dashboard','ai'], 0, 0, 180),
  ('sob_medida', 'Sob medida', 'Tudo do Pro mais funcionalidades desenvolvidas para a sua operação.',
   0, 0, 0, 0, TRUE, FALSE, 3, 0, NULL, NULL,
   ARRAY['technicians','services','service_import','hours','schedule','payroll','library',
         'porto','whatsapp','finance','billing_report','management_dashboard','ai'], 0, 0, NULL);

CREATE TABLE subscriptions (
  organization_id         UUID PRIMARY KEY REFERENCES organizations (id),
  plan_id                 UUID NOT NULL REFERENCES plans (id),
  cycle                   TEXT NOT NULL CHECK (cycle IN ('monthly', 'annual')),
  -- Prices are copied from the plan when subscribing, so editing a plan's price never changes an
  -- existing customer's bill unless the owner applies it.
  base_price              NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
  extra_technician_price  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (extra_technician_price >= 0),
  included_technicians    INTEGER NOT NULL DEFAULT 0 CHECK (included_technicians >= 0),
  discount_percent        NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  setup_fee               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  setup_fee_status        TEXT NOT NULL DEFAULT 'none' CHECK (setup_fee_status IN ('none', 'pending', 'paid', 'waived')),
  -- Days a past-due organization keeps full access before being suspended (read-only).
  grace_days              INTEGER NOT NULL DEFAULT 7 CHECK (grace_days >= 0),
  -- Per-organization overrides of the plan limits: { "maxUsers": 20, "storageMb": null, ... }.
  limit_overrides         JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_due_date           DATE,
  asaas_customer_id       TEXT,
  asaas_subscription_id   TEXT,
  asaas_setup_payment_id  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at             TIMESTAMPTZ
);

-- Who put the organization in its current status: billing automation may only undo what billing
-- did (a payment never lifts a suspension the owner applied by hand).
ALTER TABLE organizations
  ADD COLUMN status_source TEXT CHECK (status_source IN ('owner', 'billing'));

-- Mirror of the gateway's charges, kept current by its webhooks.
CREATE TABLE billing_charges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations (id),
  asaas_payment_id   TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL CHECK (kind IN ('subscription', 'setup', 'one_off', 'credits')),
  description        TEXT,
  value              NUMERIC(12, 2) NOT NULL,
  due_date           DATE NOT NULL,
  status             TEXT NOT NULL,
  billing_type       TEXT,
  invoice_url        TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX billing_charges_organization_idx ON billing_charges (organization_id, due_date DESC);
CREATE INDEX billing_charges_overdue_idx ON billing_charges (organization_id) WHERE status = 'OVERDUE';

-- Every webhook delivery, keyed by the gateway's event id so a redelivery is processed once.
CREATE TABLE billing_webhook_events (
  id            TEXT PRIMARY KEY,
  event         TEXT NOT NULL,
  payment_id    TEXT,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  error         TEXT
);

-- The plan chosen in the creation wizard, applied by the provisioning "plan" step:
-- { "planId", "cycle", "discountPercent", "discountAmount", "setupFee", "chargeSetupFee" }.
ALTER TABLE organization_provisioning ADD COLUMN subscription JSONB;
