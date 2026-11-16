-- Automatic lookup of the cars' fines (weekly, by the worker, through a paid provider).
-- A car needs its Renavam and its state (UF) to be looked up; each lookup leaves its result on the car.

ALTER TABLE vehicles
  ADD COLUMN state                CHAR(2),
  ADD COLUMN fines_checked_at     TIMESTAMPTZ,
  ADD COLUMN fines_check_status   VARCHAR(16) CHECK (fines_check_status IS NULL OR fines_check_status IN ('ok', 'partial', 'error', 'missing_data')),
  ADD COLUMN fines_check_message  TEXT;

-- Where a fine came from: typed by the admin, or found by the weekly lookup.
ALTER TABLE vehicle_fines
  ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto'));

-- Every lookup costs money, so it is a custom feature: only a company the owner grants it to is looked up.
INSERT INTO features (key, name, description, scope, builtin) VALUES
  ('fines_lookup', 'Consulta automática de multas', 'Toda semana o sistema consulta as multas dos carros da empresa e registra as novas sozinho.', 'custom', FALSE)
ON CONFLICT (key) DO NOTHING;
