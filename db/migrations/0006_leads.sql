-- Contacts that come from the marketing site's forms, worked by the platform owner until they
-- become an organization (or are lost).

CREATE TABLE leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  company          TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  technicians      INTEGER CHECK (technicians >= 0),
  plan_key         TEXT,
  cycle            TEXT CHECK (cycle IN ('monthly', 'annual')),
  message          TEXT,
  -- Which form: "contratar" (from a plan), "sob_medida" or "contato".
  origin           TEXT NOT NULL CHECK (origin IN ('contratar', 'sob_medida', 'contato')),
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'proposal', 'won', 'lost')),
  organization_id  UUID REFERENCES organizations (id),
  -- Hash of the sender's IP, only to rate-limit the public form.
  source_hash      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX leads_created_idx ON leads (created_at DESC);
CREATE INDEX leads_source_idx ON leads (source_hash, created_at DESC);

CREATE TABLE lead_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads (id),
  author_id   UUID NOT NULL REFERENCES users (id),
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lead_notes_lead_idx ON lead_notes (lead_id, created_at DESC);
