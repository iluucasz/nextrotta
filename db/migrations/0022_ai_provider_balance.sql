-- Readings of the AI provider's account balance (DeepSeek GET /user/balance). The provider has no
-- spending history, so what it really charged is the drop between consecutive readings; a rise is
-- a top-up. Read after assistant answers (at most every few minutes), hourly by the worker and when
-- the owner opens the panel (lib/ai/balance.ts).

CREATE TABLE ai_provider_balances (
  id                BIGSERIAL PRIMARY KEY,
  provider          TEXT NOT NULL DEFAULT 'deepseek',
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  currency          TEXT NOT NULL,
  total_balance     NUMERIC(14, 4) NOT NULL,
  granted_balance   NUMERIC(14, 4),
  topped_up_balance NUMERIC(14, 4),
  is_available      BOOLEAN NOT NULL
);

CREATE INDEX ai_provider_balances_collected_idx ON ai_provider_balances (provider, currency, collected_at);
