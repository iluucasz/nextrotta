-- Self-service signup from the marketing site: the company creates its account, pays the setup fee
-- and waits while the platform owner prepares it.
--   onboarding_status: awaiting_payment (setup fee not paid yet) → setup (paid; the owner is
--   configuring it) → done (released). NULL = an organization created by the owner (no onboarding).
ALTER TABLE organizations
  ADD COLUMN onboarding_status TEXT CHECK (onboarding_status IN ('awaiting_payment', 'setup', 'done')),
  ADD COLUMN signup_source TEXT CHECK (signup_source IN ('owner', 'self_service'));

-- Day of the month the customer chose to pay on (the first monthly charge is next month).
ALTER TABLE subscriptions ADD COLUMN billing_day INTEGER CHECK (billing_day BETWEEN 1 AND 28);
