-- Essencial sells no extra technicians: with a technician price of 0 the plan is a fixed cap (4 technicians).
-- Only new subscriptions copy this; existing ones keep what they subscribed with.
UPDATE plans SET extra_technician_price = 0, updated_at = NOW() WHERE key = 'essencial';

-- "Horas e banco de horas" costs R$ 19,99 as a module of "Monte o seu" (owner's correction to 0055).
UPDATE features SET module_price = 19.99, updated_at = NOW() WHERE key = 'hours' AND scope = 'general';
