-- How a company pays commission. Until now the folha had a single rule (the original client's): the
-- commission is what the production percentage leaves after the fixed salary and the meal/food cards.
--   excess      commission = percentage of the production - salary - VR - VA, never below zero (the old rule)
--   percentage  commission = percentage of the production, paid on top of the salary
--   none        no commission: only salary, overtime, award and the cards
-- Every existing company keeps 'excess', so no folha changes.

ALTER TABLE organization_settings
  ADD COLUMN commission_mode VARCHAR(16) NOT NULL DEFAULT 'excess'
  CHECK (commission_mode IN ('excess', 'percentage', 'none'));
