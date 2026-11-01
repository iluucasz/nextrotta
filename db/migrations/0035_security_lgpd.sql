-- Security and LGPD groundwork.
--   auth_throttle          failed-login counters (brute force protection); small, rows are reused, never deleted
--   legal_acceptances      who accepted which version of the terms, the privacy policy, the data processing agreement
--                          and the AI data-transfer notice, when, from where
--   data_subject_requests  requests from data subjects (LGPD art. 18) received by the public channel, with the legal deadline

CREATE TABLE auth_throttle (
  key                TEXT PRIMARY KEY,
  failures           INTEGER NOT NULL DEFAULT 0,
  window_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until       TIMESTAMPTZ
);

CREATE TABLE legal_acceptances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations (id),
  user_id          UUID,
  document         VARCHAR(16) NOT NULL CHECK (document IN ('terms', 'privacy', 'dpa', 'ai_transfer')),
  version          TEXT NOT NULL,
  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip               TEXT,
  user_agent       TEXT,
  source           VARCHAR(16) NOT NULL DEFAULT 'app' CHECK (source IN ('signup', 'app', 'owner'))
);

CREATE INDEX legal_acceptances_org_doc_idx ON legal_acceptances (organization_id, document, accepted_at DESC);

CREATE TABLE data_subject_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations (id),
  requester_name   TEXT NOT NULL,
  requester_email  TEXT NOT NULL,
  organization_hint TEXT,
  kind             VARCHAR(16) NOT NULL CHECK (kind IN ('access', 'correction', 'anonymization', 'deletion', 'portability', 'information', 'revocation', 'objection', 'other')),
  message          TEXT,
  status           VARCHAR(16) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'answered', 'rejected')),
  source_hash      TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 days',
  answered_at      TIMESTAMPTZ,
  answered_by      UUID,
  response_note    TEXT
);

CREATE INDEX data_subject_requests_status_idx ON data_subject_requests (status, received_at DESC);
