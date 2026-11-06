-- One kind of record: the CASE. Support, bug and suggestion are the types of a case (report_type), as in a service console. The
-- tickets customers open in their own system and the cases the team opens from a conversation are the same table, with the same
-- status, priority, owner, notes and history. The separate tables of 0046 (only test data) are dropped.
ALTER TABLE livechat_conversations DROP COLUMN case_id;
DROP TABLE support_case_events;
DROP TABLE support_cases;

-- A case opened by the team from a WhatsApp conversation may concern someone who is not a customer: no company, no user.
ALTER TABLE bug_reports ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE bug_reports ALTER COLUMN user_id DROP NOT NULL;

-- Where the case came from. 'portal' is what a customer opened in their system (the only ones customers see, and the only ones
-- in a company's backup); the others are the team's own, internal cases.
ALTER TABLE bug_reports ADD COLUMN origin TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'livechat', 'whatsapp', 'manual'));
ALTER TABLE bug_reports ADD COLUMN contact_name TEXT;
ALTER TABLE bug_reports ADD COLUMN contact_phone TEXT;
-- The attendant in charge (null = nobody yet).
ALTER TABLE bug_reports ADD COLUMN owner_id UUID REFERENCES users (id);
CREATE INDEX bug_reports_owner_idx ON bug_reports (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX bug_reports_phone_idx ON bug_reports (contact_phone) WHERE contact_phone IS NOT NULL;

-- "Aguardando cliente": the ball is in the customer's court.
ALTER TABLE bug_reports DROP CONSTRAINT bug_reports_status_check;
ALTER TABLE bug_reports ADD CONSTRAINT bug_reports_status_check CHECK (status IN ('new', 'investigating', 'waiting', 'resolved', 'not_reproduced'));

-- The history of a case (what a service console calls activities): who changed what and when. Internal notes are bug_messages
-- with internal = true; the replies to the customer are the other bug_messages.
CREATE TABLE bug_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_id     UUID NOT NULL REFERENCES bug_reports (id),
  kind       TEXT NOT NULL CHECK (kind IN ('created', 'status', 'priority', 'owner', 'subject', 'conversation')),
  -- Null when the system did it.
  author_id  UUID REFERENCES users (id),
  body       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX bug_events_bug_idx ON bug_events (bug_id, created_at);

-- The case a conversation was turned into. A live chat opened from a ticket already has its case (ticket_id); this is for the rest.
ALTER TABLE livechat_conversations ADD COLUMN case_id UUID REFERENCES bug_reports (id);
CREATE INDEX livechat_conversations_case_idx ON livechat_conversations (case_id) WHERE case_id IS NOT NULL;
