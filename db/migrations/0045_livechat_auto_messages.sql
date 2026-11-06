-- Automatic messages of the Livechat: what the team says on its own when a chat starts or ends, a written case is concluded, or a
-- stranger writes on the official WhatsApp number. Only what the owner changed is stored: a NULL `enabled` or `body` means "the
-- default of that message" (the defaults live in lib/livechat/auto-messages.ts), so "restore default" is an UPDATE, never a delete.
CREATE TABLE livechat_auto_messages (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN,
  body        TEXT,
  -- Business hours for the "outside hours" message ({ days: [1..5], start: "09:00", end: "18:00" }); empty = the default.
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID REFERENCES users (id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which automatic message a stored message is (null = written by a person): shown in the chat and used so each one goes out once
-- per conversation (or per window) and never in a loop.
ALTER TABLE livechat_messages ADD COLUMN auto_key TEXT;
CREATE INDEX livechat_messages_auto_idx ON livechat_messages (conversation_id, auto_key, created_at DESC) WHERE auto_key IS NOT NULL;
