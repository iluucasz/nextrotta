-- Notices for the NextRotta's own people (the owner/admins and the support users): what is going on in the organizations
-- (payments, limits, robot failures, WhatsApp, backups, credits, new cases and leads) and in the platform itself (worker,
-- gateway, AI provider). Separate from `notifications`, which is what each company sees in its own bell.
--
-- Nothing is deleted. An issue that goes away is "resolved" (resolved_at); a person "clears" a notice for themselves
-- (notice_reads.dismissed_at). The same open issue never notifies twice: while a notice with a dedupe_key is unresolved,
-- the same key only bumps `occurrences` and `last_seen_at`; once resolved, a new occurrence is a new notice.

CREATE TABLE platform_notices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = about the platform itself (worker, gateway...).
  organization_id  UUID REFERENCES organizations(id),
  -- billing | limits | automation | whatsapp | backup | ai | support | growth | security | system
  category         TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  -- 'owner' = admins only (money, platform health); 'staff' = admins and support users (cases, chats).
  audience         TEXT NOT NULL DEFAULT 'owner' CHECK (audience IN ('owner', 'staff')),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body             TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  -- A page of the owner's panel ("/plataforma/organizacoes/<id>").
  href             TEXT CHECK (href IS NULL OR (href LIKE '/%' AND href NOT LIKE '//%')),
  dedupe_key       TEXT,
  occurrences      INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX platform_notices_created_idx ON platform_notices (created_at DESC);
CREATE INDEX platform_notices_organization_idx ON platform_notices (organization_id, created_at DESC);
CREATE UNIQUE INDEX platform_notices_open_dedupe_idx ON platform_notices (dedupe_key) WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL;

-- One row per person and notice: read and/or cleared by that person only.
CREATE TABLE platform_notice_reads (
  user_id       UUID NOT NULL REFERENCES users(id),
  notice_id     UUID NOT NULL REFERENCES platform_notices(id),
  read_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, notice_id)
);
