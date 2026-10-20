/** Shared vocabulary for customer reports; persisted status values remain compatible. */
export const REPORT_TYPES = ['support', 'bug', 'suggestion'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  support: 'Suporte',
  bug: 'Bug',
  suggestion: 'Sugestão',
};

/** What a support ticket is about — the customer picks one when opening it. */
export const SUPPORT_CATEGORIES = [
  'usage',
  'access',
  'billing',
  'payroll',
  'schedule',
  'whatsapp',
  'porto',
  'import',
  'settings',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  usage: 'Dúvida de uso',
  access: 'Acesso e usuários',
  billing: 'Assinatura e cobrança',
  payroll: 'Folha e pagamentos',
  schedule: 'Escala e horas',
  whatsapp: 'WhatsApp',
  porto: 'Porto Seguro',
  import: 'Importação de dados',
  settings: 'Configurações da empresa',
  other: 'Outro assunto',
};
export const SUPPORT_CATEGORY_HINTS: Record<SupportCategory, string> = {
  usage: 'Como fazer algo no sistema',
  access: 'Senhas, logins e permissões',
  billing: 'Plano, faturas e pagamentos',
  payroll: 'Cálculo, fechamento e recibos',
  schedule: 'Montagem da escala e apontamento',
  whatsapp: 'Conexão e notificações',
  porto: 'Automação do Portal do Prestador',
  import: 'Planilhas de OS e outros dados',
  settings: 'Regras, comissão, jornada',
  other: 'Qualquer outro assunto',
};

export const REPORT_STATUS_LABELS = {
  new: 'Novo',
  investigating: 'Em análise',
  resolved: 'Resolvido',
  not_reproduced: 'Não reproduzido',
};
export type ReportStatus = keyof typeof REPORT_STATUS_LABELS;
export function reportStatusLabels(type: ReportType) {
  if (type === 'suggestion') {
    return {
      new: 'Recebida',
      investigating: 'Em análise',
      resolved: 'Concluída',
      not_reproduced: 'Não planejada',
    };
  }
  if (type === 'support') {
    return {
      new: 'Aberto',
      investigating: 'Em atendimento',
      resolved: 'Resolvido',
      not_reproduced: 'Encerrado',
    };
  }
  return REPORT_STATUS_LABELS;
}

/** "#1024" — the number customers use to refer to a ticket. */
export function formatTicketNumber(value: number | null | undefined) {
  return value ? `#${value}` : '#—';
}
