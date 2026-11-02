// Dependency-free: read by the public form (client) and by the server code.
export const REQUEST_KIND_LABELS: Record<string, string> = {
  access: 'Acesso aos meus dados',
  correction: 'Correção de dados',
  anonymization: 'Anonimização ou bloqueio',
  deletion: 'Eliminação de dados',
  portability: 'Portabilidade',
  information: 'Informação sobre o tratamento e compartilhamento',
  revocation: 'Revogação de consentimento',
  objection: 'Oposição a um tratamento',
  other: 'Outro assunto de privacidade',
};
