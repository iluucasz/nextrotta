-- Storage containers: the owner sizes file storage in containers (e.g. 10 GB with a 5% reserve) and
-- places each organization in one. Bookkeeping only: every file lives in the one Blob store, each
-- organization in its own folder (library/<organization id>/), its own limit checked on upload.
-- A container is archived (archived_at), never removed; who moved what is in audit_events.

CREATE TABLE storage_containers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  size_mb         INTEGER NOT NULL CHECK (size_mb > 0),
  reserve_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (reserve_percent >= 0 AND reserve_percent < 50),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users (id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ,
  archived_by     UUID REFERENCES users (id)
);

CREATE UNIQUE INDEX storage_containers_active_name_idx ON storage_containers (lower(name)) WHERE archived_at IS NULL;

ALTER TABLE organizations ADD COLUMN storage_container_id UUID REFERENCES storage_containers (id);
ALTER TABLE organizations ADD COLUMN storage_container_since TIMESTAMPTZ;

CREATE INDEX organizations_storage_container_idx ON organizations (storage_container_id);
