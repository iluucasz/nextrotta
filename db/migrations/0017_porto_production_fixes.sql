-- Fixes ported from the original client's system (Porto automation, schedule, hour bank, alerts):
-- the remaining hardcoded rules become per-organization settings, Porto runs record what triggered
-- them and whether the portal's screens looked changed, and an active QRA belongs to one technician.

ALTER TABLE organization_settings
  -- Shift used when nothing else says otherwise (new schedules, attendance defaults, Porto fallback).
  ADD COLUMN default_shift_start              TEXT NOT NULL DEFAULT '08:00' CHECK (default_shift_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN default_shift_end                TEXT NOT NULL DEFAULT '18:00' CHECK (default_shift_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Below this many hours in the month the technician's hours card turns red.
  ADD COLUMN monthly_hours_warning_floor      NUMERIC(6, 2) NOT NULL DEFAULT 200 CHECK (monthly_hours_warning_floor >= 0),
  -- Last day of Q1 when a service has no fortnight set.
  ADD COLUMN fortnight_split_day              INTEGER NOT NULL DEFAULT 15 CHECK (fortnight_split_day BETWEEN 1 AND 27),
  -- Whether a "Serviço cancelado" day charges its planned hours on the hour bank.
  ADD COLUMN charge_cancelled_service_planned BOOLEAN NOT NULL DEFAULT FALSE,
  -- Porto automation (worker). Times are "HH:MM", Brasília.
  ADD COLUMN porto_hours_import_time          TEXT NOT NULL DEFAULT '23:00' CHECK (porto_hours_import_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN porto_schedule_import_time       TEXT NOT NULL DEFAULT '03:00' CHECK (porto_schedule_import_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN porto_reprocess_days             INTEGER NOT NULL DEFAULT 1 CHECK (porto_reprocess_days BETWEEN 0 AND 7),
  ADD COLUMN porto_max_shift_hours            NUMERIC(4, 2) NOT NULL DEFAULT 16 CHECK (porto_max_shift_hours BETWEEN 1 AND 24),
  ADD COLUMN porto_next_month_lookahead_days  INTEGER NOT NULL DEFAULT 7 CHECK (porto_next_month_lookahead_days BETWEEN 0 AND 28),
  ADD COLUMN porto_full_day_off_percent       NUMERIC(5, 2) NOT NULL DEFAULT 90 CHECK (porto_full_day_off_percent BETWEEN 50 AND 100),
  ADD COLUMN porto_use_laudo_conclusion       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN porto_warning_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Text after the fixed "ADVERTÊNCIA:" marker; {servico} = the service code.
  ADD COLUMN porto_warning_text               TEXT NOT NULL DEFAULT 'laudo digital não preenchido no serviço {servico} — fim de jornada pelo horário de Concluído.',
  ADD COLUMN porto_record_cancelled_days      BOOLEAN NOT NULL DEFAULT TRUE,
  -- WhatsApp number of the organization's admin for the Porto robot alerts ('' = no alerts).
  ADD COLUMN porto_alert_phone                TEXT NOT NULL DEFAULT '',
  -- Finance.
  ADD COLUMN finance_due_soon_days            INTEGER NOT NULL DEFAULT 7 CHECK (finance_due_soon_days BETWEEN 0 AND 60),
  ADD COLUMN finance_categories               JSONB NOT NULL DEFAULT '["Geral", "Cartão de crédito", "Financiamento", "Aluguel", "Energia", "Água", "Internet", "Telefone", "Impostos", "Fornecedores", "Manutenção", "Combustível", "Folha", "Marketing", "Reserva", "Investimentos", "Outros"]'::jsonb;

-- 'auto' (worker schedule) or 'manual' (screen). Restarts and the end-of-shift WhatsApp only look at
-- automatic runs. layout_suspect = the run looked like the Porto portal changed its screens.
ALTER TABLE porto_sync_log
  ADD COLUMN run_trigger    VARCHAR(16) CHECK (run_trigger IN ('auto', 'manual')),
  ADD COLUMN layout_suspect BOOLEAN NOT NULL DEFAULT FALSE,
  -- How long the browser was busy, for the per-organization cost split on the owner panel.
  ADD COLUMN duration_ms    INTEGER;

CREATE INDEX porto_sync_log_auto_idx ON porto_sync_log (organization_id, job_type, run_trigger, started_at DESC);

-- The Porto import links a socorrista to a technician by QRA: two active technicians of the same
-- organization sharing one would send the hours to either of them.
CREATE UNIQUE INDEX technicians_active_qra_idx
  ON technicians (organization_id, qra)
  WHERE status = 'active' AND deleted_at IS NULL AND qra IS NOT NULL AND qra <> '';

-- Alerts sent to the platform owner (Porto screens changed, stuck run, late night queue, VPS). The
-- key de-duplicates one incident (e.g. "porto-layout:2026-10-06"), across worker restarts too.
CREATE TABLE platform_alerts (
  key               TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  organization_ids  UUID[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at           TIMESTAMPTZ,
  error             TEXT
);

CREATE INDEX platform_alerts_created_idx ON platform_alerts (created_at DESC);
