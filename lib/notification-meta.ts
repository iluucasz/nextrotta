// What each importance and each area of a notification is called on the screens. Pure (no dependencies): the bell, the
// notifications page and the tests read it, so a label is changed in one place.
import type { NotificationSeverity } from './notifications';

/** Most urgent first: the order of the filters and of the counters. */
export const SEVERITY_ORDER: NotificationSeverity[] = ['critical', 'warning', 'success', 'info'];

export const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  success: 'Concluído',
  info: 'Aviso',
};

export const SEVERITY_HELP: Record<NotificationSeverity, string> = {
  critical: 'Algo parou ou vence agora: o robô sem entrar no Porto, cobrança vencida, acesso pausado, créditos ou espaço acabando.',
  warning: 'Precisa de uma olhada em breve: folha em aberto, escala acabando, estoque baixo, venda esperando pagamento.',
  success: 'Deu certo: técnico cadastrado, folha fechada, importação do Porto feita, venda concluída.',
  info: 'Só para você saber: respostas do suporte, novidades do NextRotta.',
};

export const KIND_LABEL: Record<string, string> = {
  porto: 'Robô do Porto',
  payroll: 'Folha',
  parts: 'Venda de Peças',
  technician: 'Técnicos',
  schedule: 'Escala',
  expenses: 'Despesas',
  billing: 'Assinatura',
  credits: 'Créditos de IA',
  support: 'Suporte',
  whatsapp: 'WhatsApp',
  storage: 'Armazenamento',
  maintenance: 'Manutenção',
  system: 'NextRotta',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? 'Outros';
}

export function isSeverity(value: unknown): value is NotificationSeverity {
  return typeof value === 'string' && (SEVERITY_ORDER as string[]).includes(value);
}
