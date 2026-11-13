-- How a company's months are cut. Until now the month of an imported OS was whatever the admin picked
-- for the whole batch, and the screens always opened on the current month.
--   competence_source                batch (the month chosen for the batch: the old rule)
--                                    service_date (each OS goes to the month of its own date, so one
--                                    spreadsheet with September, October and November OS fills each month)
--   settle_previous_month_until_day  until this day of the month the screens still open on the previous
--                                    month (a company that settles October up to the 5th of November);
--                                    0 = always the current month (the old rule)
-- Every existing company keeps the old rules, so nothing changes until the admin changes it.

ALTER TABLE organization_settings
  ADD COLUMN competence_source VARCHAR(16) NOT NULL DEFAULT 'batch'
    CHECK (competence_source IN ('batch', 'service_date')),
  ADD COLUMN settle_previous_month_until_day INTEGER NOT NULL DEFAULT 0
    CHECK (settle_previous_month_until_day BETWEEN 0 AND 28);
