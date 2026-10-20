-- File storage (Vercel Blob) gets its own cost category, split among organizations by the space
-- each one uses (lib/platform/costs.ts). "vercel" stays for hosting.

ALTER TABLE infra_costs DROP CONSTRAINT infra_costs_category_check;
ALTER TABLE infra_costs ADD CONSTRAINT infra_costs_category_check
  CHECK (category IN ('vps', 'vercel', 'storage', 'database', 'domain', 'whatsapp', 'ai', 'email', 'other'));
