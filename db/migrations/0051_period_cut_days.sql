-- Payment periods inside a month. Until now a company had one cut ("last day of Q1", fortnight_split_day) and services
-- were Q1 or Q2. Now the company lists the days that cut its month:
--   []        one payment a month (no Q1/Q2 anywhere on its screens)
--   [15]      two fortnights (what every company had)
--   [10, 20]  three periods, and so on up to four cuts
-- Every existing company keeps its cut day, so nothing changes. fortnight_split_day stays in the table but is no longer
-- read or written (period_cut_days replaces it).

ALTER TABLE organization_settings
  ADD COLUMN period_cut_days JSONB NOT NULL DEFAULT '[15]'::jsonb;

UPDATE organization_settings SET period_cut_days = jsonb_build_array(fortnight_split_day);

-- A service stores the period it fell in as Q1..Q5 (NULL when the company does not cut its month).
ALTER TABLE services DROP CONSTRAINT services_fortnight_period_check;
ALTER TABLE services ADD CONSTRAINT services_fortnight_period_check CHECK (fortnight_period IN ('Q1', 'Q2', 'Q3', 'Q4', 'Q5'));
