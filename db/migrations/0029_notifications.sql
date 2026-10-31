-- Notifications: what is going on for one company (its charges, tickets, robot, credits...) and notices from the
-- platform that every company sees. A row with organization_id NULL is general; otherwise it belongs to one company.
-- Nothing is ever removed: the owner retracts a notice with archived_at, and a read is a row in notification_reads.

CREATE TABLE notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations(id),
  kind             TEXT NOT NULL DEFAULT 'system',
  severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  body             TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  href             TEXT CHECK (href IS NULL OR (href LIKE '/%' AND href NOT LIKE '//%')),
  audience         TEXT NOT NULL DEFAULT 'admins' CHECK (audience IN ('admins', 'everyone')),
  dedupe_key       TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ
);

CREATE INDEX notifications_organization_created_idx ON notifications (organization_id, created_at DESC) WHERE archived_at IS NULL;

-- The same event never notifies twice: automatic notifications carry a key such as "billing:overdue:<charge>".
CREATE UNIQUE INDEX notifications_dedupe_idx
  ON notifications (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
  WHERE dedupe_key IS NOT NULL AND archived_at IS NULL;

CREATE TABLE notification_reads (
  user_id          UUID NOT NULL REFERENCES users(id),
  notification_id  UUID NOT NULL REFERENCES notifications(id),
  read_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notification_id)
);
