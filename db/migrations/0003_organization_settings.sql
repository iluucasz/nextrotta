-- Business rules that used to be hardcoded for the original client, now set per organization by
-- its admin (and the platform owner). Technicians' own values (commission, salary, VA, VR) still
-- win when filled; these are the defaults for the ones left empty.

CREATE TABLE organization_settings (
  organization_id        UUID PRIMARY KEY REFERENCES organizations (id),
  commission_percentage  NUMERIC(5, 2) NOT NULL DEFAULT 25 CHECK (commission_percentage >= 0 AND commission_percentage <= 100),
  base_salary            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  va_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (va_allowance >= 0),
  vr_allowance           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (vr_allowance >= 0),
  -- Monthly working hours: the hour-bank target and the divisor for the hourly rate.
  monthly_hours          NUMERIC(6, 2) NOT NULL DEFAULT 220 CHECK (monthly_hours > 0),
  overtime_multiplier    NUMERIC(4, 2) NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier >= 1),
  -- Break deducted from each day's span when turning start/end times into worked hours.
  daily_break_minutes    INTEGER NOT NULL DEFAULT 60 CHECK (daily_break_minutes >= 0 AND daily_break_minutes <= 240),
  -- Production award: [{"minServices": 80, "amount": 250}, ...]. Also drives the technicians' goals.
  service_award_tiers    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             UUID
);

INSERT INTO organization_settings (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
