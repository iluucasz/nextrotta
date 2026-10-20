-- Platform owner panel: organization lifecycle, provisioning, internal notes, impersonation
-- ("entrar na conta") and the audit trail.

ALTER TABLE organizations
  ADD COLUMN city               TEXT,
  ADD COLUMN state              TEXT,
  ADD COLUMN activated_at       TIMESTAMPTZ,
  ADD COLUMN status_reason      TEXT,
  ADD COLUMN status_changed_at  TIMESTAMPTZ;

-- One provisioning run per organization. `steps` is the ordered list shown on the progress screen:
-- [{ "key", "label", "status": pending|running|done|skipped|error, "startedAt", "finishedAt", "error", "note" }]
CREATE TABLE organization_provisioning (
  organization_id  UUID PRIMARY KEY REFERENCES organizations (id),
  admin_name       TEXT NOT NULL,
  admin_email      TEXT NOT NULL,
  steps            JSONB NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The owner's private notes about a customer. The organization never sees them.
CREATE TABLE organization_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  author_id        UUID NOT NULL REFERENCES users (id),
  text             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX organization_notes_organization_idx ON organization_notes (organization_id, created_at DESC);

-- The owner acting inside an organization. A session token is only honored while its row is open
-- (ended_at null) and not expired.
CREATE TABLE impersonation_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES users (id),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  reason           TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ
);

CREATE INDEX impersonation_sessions_organization_idx ON impersonation_sessions (organization_id, started_at DESC);

-- A login handoff can also carry an impersonation session; user_id is then the owner.
ALTER TABLE auth_handoffs ADD COLUMN impersonation_id UUID REFERENCES impersonation_sessions (id);

CREATE TABLE audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID REFERENCES organizations (id),
  actor_id          UUID REFERENCES users (id),
  actor_role        TEXT,
  impersonation_id  UUID REFERENCES impersonation_sessions (id),
  action            TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  details           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_organization_idx ON audit_events (organization_id, created_at DESC);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_impersonation_idx ON audit_events (impersonation_id) WHERE impersonation_id IS NOT NULL;
