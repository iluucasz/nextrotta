-- Prazo do laudo (ported from the production fix of 2026-10-07): hours after the service's
-- "Concluído" the technician has to fill in the laudo. A run inside that window records the day as
-- "LAUDO PENDENTE:" and recomputes it next time, so the import time never decides the warning.
-- The reprocess window is at least 1 day now: a run may happen before the day is over.
ALTER TABLE organization_settings
  ADD COLUMN porto_laudo_grace_hours NUMERIC(5, 2) NOT NULL DEFAULT 6 CHECK (porto_laudo_grace_hours BETWEEN 0 AND 48);

UPDATE organization_settings SET porto_reprocess_days = 1 WHERE porto_reprocess_days < 1;
ALTER TABLE organization_settings DROP CONSTRAINT organization_settings_porto_reprocess_days_check;
ALTER TABLE organization_settings ADD CONSTRAINT organization_settings_porto_reprocess_days_check CHECK (porto_reprocess_days BETWEEN 1 AND 7);
