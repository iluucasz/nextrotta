-- How the meal (VR) and food (VA) vouchers are treated. Until now both were always taken off the commission
-- (the "excess" mode: commission = production - salary - VR - VA) and always loaded on a card.
--   *_deducts_from_commission  true  the voucher counts as a fixed cost before the commission starts (the old rule)
--                              false the commission ignores it
--   *_payment                  card  paid on a card, apart from the account payment (the old rule)
--                              cash  paid in cash, apart from the account payment
-- The payment only changes the wording of the folha, its PDF and the technician's screen: the total cost is
-- the same. Every existing company keeps the old rules, so no folha changes.

ALTER TABLE organization_settings
  ADD COLUMN va_deducts_from_commission BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN vr_deducts_from_commission BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN va_payment VARCHAR(8) NOT NULL DEFAULT 'card' CHECK (va_payment IN ('card', 'cash')),
  ADD COLUMN vr_payment VARCHAR(8) NOT NULL DEFAULT 'card' CHECK (vr_payment IN ('card', 'cash'));
