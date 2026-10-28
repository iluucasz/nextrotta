-- One assistant question at a time per organization. The balance is checked before the answer and
-- debited after it, so two questions in flight could both pass with credit for only one. A question
-- takes this lock before the check and releases it after the debit; a lock left behind by a crashed
-- request simply expires. Rows are never deleted: releasing sets locked_until to the past.
CREATE TABLE ai_request_locks (
  organization_id  UUID PRIMARY KEY REFERENCES organizations (id),
  locked_until     TIMESTAMPTZ NOT NULL
);
