-- Follow-up questions the assistant suggests after each answer (from the [[SUGESTOES]] marker the
-- model appends; see splitFollowUps in lib/ai/assistant.ts). Shown as buttons under the last answer.
ALTER TABLE ai_messages ADD COLUMN suggestions JSONB;
