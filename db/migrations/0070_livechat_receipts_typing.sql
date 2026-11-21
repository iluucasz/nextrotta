-- Livechat: delivered/read marks on messages and the "typing" signal of each side.
--   livechat_messages.delivered_at / read_at: for what the team sent, when the customer's window (or WhatsApp) received and read it;
--   for what the customer sent, read_at is when the team opened the conversation (the customer sees "Visto").
--   livechat_conversations.customer_typing_until / owner_typing_until: "digitando…" is shown while the time is in the future.
ALTER TABLE livechat_messages
  ADD COLUMN delivered_at TIMESTAMPTZ,
  ADD COLUMN read_at TIMESTAMPTZ;

ALTER TABLE livechat_conversations
  ADD COLUMN customer_typing_until TIMESTAMPTZ,
  ADD COLUMN owner_typing_until TIMESTAMPTZ;
