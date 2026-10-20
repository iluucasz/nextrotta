-- Existing reports remain bugs. Suggestions share the same protected conversation and attachments.
ALTER TABLE bug_reports
  ADD COLUMN report_type TEXT NOT NULL DEFAULT 'bug'
  CHECK (report_type IN ('bug', 'suggestion'));
