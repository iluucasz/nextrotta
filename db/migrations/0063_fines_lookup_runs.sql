-- History of the fines lookups of each company: the weekly automatic one (Sundays) and the manual "Verificar agora" (once a day).
-- It is what the screen lists, and what locks the manual button until the next day.

CREATE TABLE fines_lookup_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  kind             VARCHAR(8) NOT NULL CHECK (kind IN ('weekly', 'manual')),
  status           VARCHAR(8) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  -- Cars asked about, fines registered because of it, and cars the provider could not answer for.
  cars             INTEGER NOT NULL DEFAULT 0,
  created          INTEGER NOT NULL DEFAULT 0,
  failed           INTEGER NOT NULL DEFAULT 0,
  message          TEXT,
  triggered_by     UUID
);

CREATE INDEX fines_lookup_runs_org_idx ON fines_lookup_runs (organization_id, started_at DESC);
