-- A ticket is either a case (written support: the conversation lives in the ticket, answered by e-mail-like replies) or a live chat
-- (urgent: the whole attendance happens in the Livechat). The two are kept apart, like Cases and Omni-Channel sessions:
-- a live chat has no written thread and a case has no chat window.

ALTER TABLE bug_reports ADD COLUMN channel TEXT NOT NULL DEFAULT 'case' CHECK (channel IN ('case', 'chat'));

-- Tickets that already have a web chat were opened as live chats.
UPDATE bug_reports SET channel = 'chat'
WHERE id IN (SELECT ticket_id FROM livechat_conversations WHERE channel = 'web' AND ticket_id IS NOT NULL);

CREATE INDEX bug_reports_channel_idx ON bug_reports (channel, created_at DESC);
