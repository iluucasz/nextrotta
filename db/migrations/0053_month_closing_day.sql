-- The day the month closes for payment (0 = its last day, what every company had). With 25, the competence of
-- November covers 26/10 to 25/11. Read by lib/pay-calendar.ts (OS, hours and days worked follow it).
ALTER TABLE organization_settings
  ADD COLUMN month_closing_day INTEGER NOT NULL DEFAULT 0
    CHECK (month_closing_day BETWEEN 0 AND 27);
