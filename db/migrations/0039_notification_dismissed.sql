-- "Limpar" a notification: each person clears their own bell and list without removing anything. A cleared notification
-- stays in the table (the same event never notifies twice) and can be restored from the "Limpas" view.
ALTER TABLE notification_reads ADD COLUMN dismissed_at TIMESTAMPTZ;

CREATE INDEX notification_reads_dismissed_idx ON notification_reads (user_id) WHERE dismissed_at IS NOT NULL;
