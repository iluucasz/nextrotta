-- Pro: 12 technicians included and the same R$ 19,99 per extra technician as "Monte o seu".
-- New subscriptions only; existing ones keep what they subscribed with.
UPDATE plans SET included_technicians = 12, extra_technician_price = 19.99, updated_at = NOW() WHERE key = 'pro';
