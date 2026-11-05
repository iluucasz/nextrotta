-- Backups: shorter keeping (a daily copy of every company for years is too much) and the copy made right before the
-- access is locked.
--   Essencial and "Monte o seu" keep 30 days of daily backups, Pro keeps 90 (it was 90 and 180). The owner can still edit
--   each plan in Planos; only the values of the existing plans change here. Copies older than that leave the storage the
--   next night (the only hard deletion in the system, and it only touches backup copies).
--   closing: a copy made on the day before a lock and when the company is suspended or canceled, so what the company
--   downloads from the "acesso encerrado" page is as recent as possible.
-- And a suspended or canceled company is locked right away (no read-only period): the owner can still set a number of
-- days of consultation in Configurações.

UPDATE plans SET backup_retention_days = 30 WHERE archived_at IS NULL AND (name = 'Essencial' OR kind = 'builder');
UPDATE plans SET backup_retention_days = 90 WHERE archived_at IS NULL AND name = 'Pro';

ALTER TABLE organization_backups DROP CONSTRAINT organization_backups_kind_check;
ALTER TABLE organization_backups
  ADD CONSTRAINT organization_backups_kind_check CHECK (kind IN ('daily', 'manual', 'before_restore', 'closing'));

UPDATE platform_settings SET data = jsonb_set(data, '{readOnlyDays}', '0'::jsonb) WHERE data ? 'readOnlyDays';
