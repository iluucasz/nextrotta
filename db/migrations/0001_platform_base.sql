-- Multi-tenant foundation: organizations, platform-owned users, cross-subdomain login handoff,
-- and the core domain tables that previously only existed in the dedicated client's database
-- (they were never created by code). Every domain table carries organization_id and soft-delete
-- columns: rows are never removed, only marked with deleted_at.

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  legal_name  TEXT,
  document    TEXT,
  email       TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'provisioning'
              CHECK (status IN ('provisioning', 'active', 'past_due', 'suspended', 'canceled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID,
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

-- Not partial on purpose: a slug is a public address and is never handed to another organization,
-- even after the original one is archived.
CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug);

CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations (id),
  email            TEXT NOT NULL,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('platform_owner', 'admin', 'technician')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID,
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  -- The platform owner sits above every organization; everyone else belongs to exactly one.
  CONSTRAINT users_owner_has_no_organization CHECK ((role = 'platform_owner') = (organization_id IS NULL))
);

-- E-mail identifies the organization at login, so it is unique across the whole platform.
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_organization_id_idx ON users (organization_id);

-- One-time codes that carry a login from the root domain to the organization's subdomain, so the
-- session cookie can stay host-only (a cookie for one organization is never sent to another).
CREATE TABLE auth_handoffs (
  code_hash        TEXT PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users (id),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE technicians (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations (id),
  user_id                UUID REFERENCES users (id),
  qra                    TEXT,
  name                   TEXT NOT NULL,
  email                  TEXT,
  phone                  TEXT,
  porto_name_hint        TEXT,
  commission_percentage  NUMERIC(5, 2) NOT NULL DEFAULT 25,
  base_salary            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  va_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vr_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ,
  deleted_by             UUID
);

CREATE INDEX technicians_organization_id_idx ON technicians (organization_id, name);
CREATE UNIQUE INDEX technicians_user_id_key ON technicians (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX technicians_email_key ON technicians (organization_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id),
  order_code        TEXT NOT NULL,
  technician_id     UUID NOT NULL REFERENCES technicians (id),
  service_type      TEXT NOT NULL,
  value             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  date_performed    DATE NOT NULL,
  time_performed    TIME,
  competence_month  VARCHAR(7) NOT NULL,
  fortnight_period  VARCHAR(2) CHECK (fortnight_period IN ('Q1', 'Q2')),
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID
);

CREATE INDEX services_organization_competence_idx ON services (organization_id, competence_month);
CREATE INDEX services_technician_competence_idx ON services (technician_id, competence_month);
CREATE INDEX services_organization_order_code_idx ON services (organization_id, order_code);

CREATE TABLE work_hours (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  technician_id    UUID NOT NULL REFERENCES technicians (id),
  date             DATE NOT NULL,
  start_time       TIME,
  end_time         TIME,
  hours_worked     NUMERIC(6, 2) NOT NULL DEFAULT 0,
  week_number      INTEGER,
  month            INTEGER,
  year             INTEGER,
  source           VARCHAR(16) NOT NULL DEFAULT 'manual',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX work_hours_organization_date_idx ON work_hours (organization_id, date);
CREATE INDEX work_hours_technician_date_idx ON work_hours (technician_id, date);

CREATE TYPE schedule_status AS ENUM ('scheduled', 'completed', 'cancelled');

CREATE TABLE schedule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  technician_id    UUID NOT NULL REFERENCES technicians (id),
  date             DATE NOT NULL,
  start_time       TIME,
  end_time         TIME,
  status           schedule_status NOT NULL DEFAULT 'scheduled',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX schedule_organization_date_idx ON schedule (organization_id, date);
CREATE INDEX schedule_technician_date_idx ON schedule (technician_id, date);

CREATE TABLE payroll (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID NOT NULL REFERENCES organizations (id),
  technician_id              UUID NOT NULL REFERENCES technicians (id),
  competence_month           VARCHAR(7) NOT NULL,
  total_services_value       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  commission_value           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  base_salary                NUMERIC(12, 2) NOT NULL DEFAULT 0,
  va_deduction               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vr_deduction               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discounts_total            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  advances_total             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  extra_hours_value          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  extraordinary_award_value  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  hour_bank_balance          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  net_total                  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status                     VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                 TIMESTAMPTZ,
  deleted_by                 UUID,
  -- Upsert target used by the payroll routes; a technician belongs to a single organization.
  CONSTRAINT payroll_technician_competence_key UNIQUE (technician_id, competence_month)
);

CREATE INDEX payroll_organization_competence_idx ON payroll (organization_id, competence_month);

CREATE TABLE discounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id),
  technician_id     UUID NOT NULL REFERENCES technicians (id),
  type              TEXT NOT NULL CHECK (type IN ('discount', 'advance', 'other')),
  amount            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reason            TEXT,
  competence_month  VARCHAR(7) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID
);

CREATE INDEX discounts_organization_competence_idx ON discounts (organization_id, competence_month);
CREATE INDEX discounts_technician_competence_idx ON discounts (technician_id, competence_month);
