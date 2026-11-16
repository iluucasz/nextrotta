-- How many instalments the subscription's setup fee was split into (copied from the plan when the first
-- charge is created, so a later price change never reshapes a customer's payment plan).
ALTER TABLE subscriptions ADD COLUMN setup_installments INTEGER NOT NULL DEFAULT 1 CHECK (setup_installments BETWEEN 1 AND 12);
