-- The AI assistant (DeepSeek): each admin's conversations and their messages. Every answered
-- question consumes the organization's credits (a "consumption" entry in ai_credit_ledger).

CREATE TABLE ai_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  user_id          UUID NOT NULL REFERENCES users (id),
  title            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

CREATE INDEX ai_conversations_user_idx ON ai_conversations (organization_id, user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES ai_conversations (id),
  organization_id    UUID NOT NULL REFERENCES organizations (id),
  role               TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content            TEXT NOT NULL,
  -- Which data the assistant looked up to answer: [{ "name", "arguments" }].
  tools_used         JSONB,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  -- What the provider charged for this answer, in R$.
  cost               NUMERIC(12, 6),
  credits            INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_messages_conversation_idx ON ai_messages (conversation_id, created_at);

ALTER TABLE ai_credit_ledger ADD COLUMN message_id UUID REFERENCES ai_messages (id);
