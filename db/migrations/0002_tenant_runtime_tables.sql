-- Tables that used to be created at runtime by ensure*Schema(), now versioned and scoped by
-- organization. Single-row settings tables (porto_config, whatsapp_config) become one row per
-- organization, keyed by organization_id.

CREATE TABLE financial_entries (
  id                  TEXT PRIMARY KEY,
  organization_id     UUID NOT NULL REFERENCES organizations (id),
  type                VARCHAR(16) NOT NULL CHECK (type IN ('payable', 'receivable')),
  description         TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'Geral',
  amount              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_date            DATE NOT NULL,
  competence_month    VARCHAR(7) NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_at             DATE,
  series_id           TEXT,
  installment_number  INTEGER NOT NULL DEFAULT 1,
  installment_total   INTEGER NOT NULL DEFAULT 1,
  is_recurring        BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID
);

CREATE INDEX financial_entries_organization_competence_idx ON financial_entries (organization_id, competence_month);
CREATE INDEX financial_entries_organization_due_date_idx ON financial_entries (organization_id, due_date);
CREATE INDEX financial_entries_series_idx ON financial_entries (series_id);

CREATE TABLE library_documents (
  id               TEXT PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  title            TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Não classificado',
  audience         TEXT NOT NULL DEFAULT 'Global',
  type             TEXT NOT NULL DEFAULT 'PDF',
  url              TEXT,
  technician_id    TEXT,
  file_name        TEXT,
  file_size        BIGINT,
  uploaded_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX library_documents_organization_updated_idx ON library_documents (organization_id, updated_at DESC);
CREATE INDEX library_documents_technician_idx ON library_documents (technician_id);

CREATE TABLE porto_config (
  organization_id              UUID PRIMARY KEY REFERENCES organizations (id),
  cpf                          TEXT,
  encrypted_password           TEXT,
  automation_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run_only                 BOOLEAN NOT NULL DEFAULT TRUE,
  last_hours_import_at         TIMESTAMPTZ,
  last_hours_import_status     VARCHAR(16),
  last_schedule_check_at       TIMESTAMPTZ,
  last_schedule_import_month   VARCHAR(7),
  last_schedule_import_status  VARCHAR(16),
  last_error                   TEXT,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                   TEXT
);

CREATE TABLE porto_sync_log (
  id                     TEXT PRIMARY KEY,
  organization_id        UUID NOT NULL REFERENCES organizations (id),
  job_type               VARCHAR(16) NOT NULL CHECK (job_type IN ('hours', 'schedule')),
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at            TIMESTAMPTZ,
  status                 VARCHAR(16) NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running', 'success', 'partial', 'error', 'skipped', 'dry_run')),
  technicians_processed  INTEGER NOT NULL DEFAULT 0,
  rows_written           INTEGER NOT NULL DEFAULT 0,
  details                JSONB,
  error_message          TEXT,
  range_start            DATE,
  range_end              DATE
);

CREATE INDEX porto_sync_log_organization_job_idx ON porto_sync_log (organization_id, job_type, started_at DESC);

-- One row per scope (`global`, or a technicians.id override) per organization. "Removing" an
-- override marks it deleted; saving the scope again revives the row.
CREATE TABLE technician_visibility_settings (
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  scope            TEXT NOT NULL,
  settings         JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT,
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID,
  PRIMARY KEY (organization_id, scope)
);

CREATE TABLE whatsapp_config (
  organization_id  UUID PRIMARY KEY REFERENCES organizations (id),
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  test_phone       TEXT,
  app_url          TEXT,
  notifications    JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_runs         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT
);

-- Both the send history and the de-duplication ledger: a notification claims its dedupe_key
-- (unique per organization) before sending.
CREATE TABLE whatsapp_messages (
  id                  TEXT PRIMARY KEY,
  organization_id     UUID NOT NULL REFERENCES organizations (id),
  technician_id       TEXT,
  technician_name     TEXT,
  phone               TEXT,
  type                VARCHAR(32) NOT NULL,
  trigger_kind        VARCHAR(16) NOT NULL,
  dedupe_key          TEXT,
  reference_date      DATE,
  message             TEXT NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'pending',
  error               TEXT,
  redirected_to_test  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID,
  CONSTRAINT whatsapp_messages_dedupe_key UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX whatsapp_messages_organization_created_idx ON whatsapp_messages (organization_id, created_at DESC);
CREATE INDEX whatsapp_messages_technician_idx ON whatsapp_messages (technician_id, created_at DESC);
