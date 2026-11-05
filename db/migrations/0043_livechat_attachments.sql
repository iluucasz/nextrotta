-- Files sent in a live chat (a pasted screenshot, a PDF, a spreadsheet). They live in the private store, in the folder of the company
-- the chat belongs to, and what the customer sends counts against that company's storage (the same view the limits and the
-- capacity screens already read). What the team sends back is kept there too but is not charged to the customer.

CREATE TABLE livechat_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES livechat_messages (id),
  conversation_id  UUID NOT NULL REFERENCES livechat_conversations (id),
  -- The company whose folder holds the file; null for a conversation with someone the platform does not know.
  organization_id  UUID REFERENCES organizations (id),
  file_name        TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  file_size        INTEGER NOT NULL CHECK (file_size >= 0),
  -- Private address in the blob store: only ever served through the system, after checking who is asking.
  url              TEXT NOT NULL,
  -- True for what the customer sent (charged to the company's plan), false for what the team sent.
  counted          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX livechat_attachments_message_idx ON livechat_attachments (message_id);
CREATE INDEX livechat_attachments_conversation_idx ON livechat_attachments (conversation_id);

-- The files an organization stores, for the storage limit and the owner's capacity screens.
CREATE OR REPLACE VIEW organization_files AS
  SELECT organization_id, file_size::bigint AS bytes FROM library_documents
  UNION ALL
  SELECT organization_id, file_size::bigint AS bytes FROM part_images
  UNION ALL
  SELECT organization_id, file_size::bigint AS bytes FROM livechat_attachments WHERE organization_id IS NOT NULL AND counted;
