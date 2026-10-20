-- Backends for the remaining sections of the owner panel: platform settings, coupons, the feature
-- catalog (custom features per organization), AI credits, bug reports, news (changelog), the
-- marketing site's content and the worker's health.

-- One row with the platform-wide settings edited by the owner.
CREATE TABLE platform_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- { "defaultGraceDays", "reservedSubdomains": [], "maintenance": { "enabled", "message" },
  --   "ai": { "inputCostPerMillion", "outputCostPerMillion", "creditsPerUse" } }
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users (id)
);

INSERT INTO platform_settings (data) VALUES ('{}'::jsonb);

-- Coupons: a discount the owner applies to an organization's subscription for some cycles.
CREATE TABLE coupons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value            NUMERIC(12, 2) NOT NULL CHECK (value > 0),
  -- How many billing cycles the discount lasts; 0 = permanent.
  duration_cycles  INTEGER NOT NULL DEFAULT 0 CHECK (duration_cycles >= 0),
  expires_on       DATE,
  -- Plan keys the coupon applies to; empty = every plan.
  plan_keys        TEXT[] NOT NULL DEFAULT '{}',
  max_uses         INTEGER CHECK (max_uses > 0),
  created_by       UUID REFERENCES users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ
);

-- A coupon applied to an organization. The subscription's previous discount is kept so removing or
-- expiring the coupon puts it back.
CREATE TABLE coupon_redemptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id                 UUID NOT NULL REFERENCES coupons (id),
  organization_id           UUID NOT NULL REFERENCES organizations (id),
  previous_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  previous_discount_amount  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- Last day the discount applies; NULL = permanent.
  ends_on                   DATE,
  applied_by                UUID REFERENCES users (id),
  applied_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                  TIMESTAMPTZ,
  end_reason                TEXT CHECK (end_reason IN ('expired', 'removed'))
);

CREATE UNIQUE INDEX coupon_redemptions_active_idx ON coupon_redemptions (organization_id) WHERE ended_at IS NULL;
CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id);

-- Feature catalog. General features are unlocked by plans; custom ones only by an explicit grant to
-- an organization, until the owner promotes them to general.
CREATE TABLE features (
  key          TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name         TEXT NOT NULL,
  description  TEXT,
  scope        TEXT NOT NULL CHECK (scope IN ('general', 'custom')),
  -- Built into the product (lib/plans.ts); can't be archived.
  builtin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   UUID REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at  TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ
);

INSERT INTO features (key, name, scope, builtin) VALUES
  ('technicians', 'Técnicos', 'general', TRUE),
  ('services', 'Ordens de serviço', 'general', TRUE),
  ('service_import', 'Importação de planilhas de OS', 'general', TRUE),
  ('hours', 'Horas e banco de horas', 'general', TRUE),
  ('schedule', 'Escala', 'general', TRUE),
  ('payroll', 'Folha de pagamento e recibo', 'general', TRUE),
  ('library', 'Biblioteca de documentos', 'general', TRUE),
  ('porto', 'Automação Porto Seguro', 'general', TRUE),
  ('whatsapp', 'Notificações por WhatsApp', 'general', TRUE),
  ('finance', 'Controle financeiro', 'general', TRUE),
  ('billing_report', 'Faturamento', 'general', TRUE),
  ('management_dashboard', 'Dashboard gerencial', 'general', TRUE),
  ('ai', 'Assistente de IA', 'general', TRUE);

CREATE TABLE organization_features (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  feature_key      TEXT NOT NULL REFERENCES features (key),
  granted_by       UUID REFERENCES users (id),
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by       UUID REFERENCES users (id),
  revoked_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX organization_features_active_idx ON organization_features (organization_id, feature_key) WHERE revoked_at IS NULL;

-- AI credits: packages for sale and each organization's ledger (balance = sum of quantity).
CREATE TABLE ai_credit_packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  credits      INTEGER NOT NULL CHECK (credits > 0),
  price        NUMERIC(12, 2) NOT NULL CHECK (price > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);

ALTER TABLE billing_charges
  ADD COLUMN credit_package_id UUID REFERENCES ai_credit_packages (id),
  ADD COLUMN credits           INTEGER;

CREATE TABLE ai_credit_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  kind             TEXT NOT NULL CHECK (kind IN ('monthly', 'bonus', 'purchase', 'consumption', 'adjustment')),
  -- Positive adds credits, negative consumes them.
  quantity         INTEGER NOT NULL CHECK (quantity <> 0),
  -- What the AI provider charged for a consumption, in R$.
  cost             NUMERIC(12, 6),
  -- Monthly grants: the month ("YYYY-MM"), so each month is granted once.
  period           TEXT,
  charge_id        UUID REFERENCES billing_charges (id),
  description      TEXT,
  created_by       UUID REFERENCES users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_credit_ledger_organization_idx ON ai_credit_ledger (organization_id, created_at DESC);
CREATE UNIQUE INDEX ai_credit_ledger_monthly_idx ON ai_credit_ledger (organization_id, period) WHERE kind = 'monthly';
CREATE UNIQUE INDEX ai_credit_ledger_bonus_idx ON ai_credit_ledger (organization_id) WHERE kind = 'bonus';
CREATE UNIQUE INDEX ai_credit_ledger_charge_idx ON ai_credit_ledger (charge_id) WHERE charge_id IS NOT NULL;

-- Problems reported from inside an organization's system, and the conversation about each one.
CREATE TABLE bug_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  user_id          UUID NOT NULL REFERENCES users (id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  page_url         TEXT,
  user_agent       TEXT,
  app_version      TEXT,
  -- Optional screenshot as a data URL (size-limited by the API).
  screenshot       TEXT,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'resolved', 'not_reproduced')),
  priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX bug_reports_created_idx ON bug_reports (created_at DESC);
CREATE INDEX bug_reports_organization_idx ON bug_reports (organization_id, created_at DESC);

CREATE TABLE bug_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_id      UUID NOT NULL REFERENCES bug_reports (id),
  author_id   UUID NOT NULL REFERENCES users (id),
  from_owner  BOOLEAN NOT NULL,
  -- Internal notes are the owner's only; the organization never sees them.
  internal    BOOLEAN NOT NULL DEFAULT FALSE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bug_messages_bug_idx ON bug_messages (bug_id, created_at);

-- Release notes, published on the site, inside the organizations' system, or both.
CREATE TABLE news_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  published_on  DATE NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('feature', 'improvement', 'fix')),
  body          TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  destination   TEXT NOT NULL CHECK (destination IN ('site', 'system', 'both')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by    UUID REFERENCES users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);

CREATE INDEX news_posts_published_idx ON news_posts (published_on DESC) WHERE status = 'published' AND archived_at IS NULL;

-- The marketing site's content: the owner edits a draft and publishes it. NULL = code defaults.
CREATE TABLE site_content (
  id                BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  draft             JSONB,
  published         JSONB,
  draft_updated_at  TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  published_by      UUID REFERENCES users (id)
);

INSERT INTO site_content DEFAULT VALUES;

-- The worker's pulse and its job runs, for the Operation screen.
CREATE TABLE worker_heartbeats (
  worker_id     TEXT PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL,
  version       TEXT
);

CREATE TABLE worker_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job              TEXT NOT NULL,
  organization_id  UUID REFERENCES organizations (id),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  error            TEXT
);

CREATE INDEX worker_runs_started_idx ON worker_runs (started_at DESC);
