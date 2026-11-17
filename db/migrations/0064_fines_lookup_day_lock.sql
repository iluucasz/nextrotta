-- The manual "Verificar agora" may be used once a day per company. The database itself decides who gets the day: the line of a manual
-- lookup carries the day it holds (lock_day) and only one line per company can hold a given day, even if two clicks arrive at the same
-- moment. A lookup that fails (or dies) lets the day go (lock_day back to NULL).

ALTER TABLE fines_lookup_runs ADD COLUMN lock_day DATE;

CREATE UNIQUE INDEX fines_lookup_runs_day_lock_idx ON fines_lookup_runs (organization_id, lock_day) WHERE lock_day IS NOT NULL;
