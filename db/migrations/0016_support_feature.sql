-- Support (tickets in the system + the team's help) is part of every plan: a core feature, listed
-- on the site with the others and never removable from a plan.

INSERT INTO features (key, name, description, scope, builtin) VALUES
  ('support', 'Suporte', 'Chamados de suporte direto pelo sistema, com acompanhamento da nossa equipe.', 'general', TRUE)
ON CONFLICT (key) DO NOTHING;

UPDATE plans SET features = array_append(features, 'support'), updated_at = NOW()
WHERE NOT ('support' = ANY (features));
