-- Live chat: urgent conversations opened from a support ticket (web) and conversations with the platform's official WhatsApp
-- number (whatsapp), read and answered by the owner in one inbox (Reports -> Livechat). Nothing is ever deleted: a finished
-- conversation is closed and a new message of the customer reopens it.

CREATE TABLE livechat_conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel               TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp')),
  -- Always set for the web chat; for WhatsApp only when the number belongs to a known technician or company.
  organization_id       UUID REFERENCES organizations (id),
  -- The support ticket the web chat belongs to.
  ticket_id             UUID REFERENCES bug_reports (id),
  user_id               UUID REFERENCES users (id),
  contact_name          TEXT,
  -- WhatsApp number, digits with the country code (55...). Null on the web chat.
  contact_phone         TEXT,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  urgent                BOOLEAN NOT NULL DEFAULT FALSE,
  unread_owner          INTEGER NOT NULL DEFAULT 0 CHECK (unread_owner >= 0),
  unread_customer       INTEGER NOT NULL DEFAULT 0 CHECK (unread_customer >= 0),
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at             TIMESTAMPTZ,
  CONSTRAINT livechat_web_needs_ticket CHECK (channel <> 'web' OR (organization_id IS NOT NULL AND ticket_id IS NOT NULL AND user_id IS NOT NULL)),
  CONSTRAINT livechat_whatsapp_needs_phone CHECK (channel <> 'whatsapp' OR contact_phone IS NOT NULL)
);

CREATE INDEX livechat_conversations_inbox_idx ON livechat_conversations (status, last_message_at DESC);
CREATE INDEX livechat_conversations_organization_idx ON livechat_conversations (organization_id) WHERE organization_id IS NOT NULL;
-- At most one open conversation per ticket and one per WhatsApp number.
CREATE UNIQUE INDEX livechat_open_ticket_idx ON livechat_conversations (ticket_id) WHERE channel = 'web' AND status = 'open';
CREATE UNIQUE INDEX livechat_open_phone_idx ON livechat_conversations (contact_phone) WHERE channel = 'whatsapp' AND status = 'open';

CREATE TABLE livechat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES livechat_conversations (id),
  -- 'in' = from the customer, 'out' = from the platform (the owner, in the panel or on the phone).
  direction        TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender_name      TEXT,
  body             TEXT NOT NULL,
  -- 'system' lines (chat started, closed) are shown in the middle; 'media' is a placeholder for what only WhatsApp can open.
  kind             TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'media', 'system')),
  -- WhatsApp's own id: makes a delivery of the same message (or the echo of what the panel sent) count once.
  wa_message_id    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX livechat_messages_conversation_idx ON livechat_messages (conversation_id, created_at);
CREATE UNIQUE INDEX livechat_messages_wa_idx ON livechat_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
