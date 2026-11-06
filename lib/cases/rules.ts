// No dependencies on the database or the framework: used by the routes, the panel and the tests.
// The cases of the team: vocabulary, limits, what a case starts with, and the history lines.

export const CASE_STATUSES = ['new', 'working', 'waiting', 'resolved'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = { new: 'Novo', working: 'Em andamento', waiting: 'Aguardando cliente', resolved: 'Resolvido' };

export const CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

export const CASE_ORIGINS = ['livechat', 'whatsapp', 'manual'] as const;
export type CaseOrigin = (typeof CASE_ORIGINS)[number];
export const CASE_ORIGIN_LABELS: Record<CaseOrigin, string> = { livechat: 'Chat ao vivo', whatsapp: 'WhatsApp', manual: 'Criado à mão' };

export const MAX_SUBJECT_LENGTH = 140;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_NOTE_LENGTH = 2000;

export const isCaseStatus = (value: unknown): value is CaseStatus => (CASE_STATUSES as readonly unknown[]).includes(value);
export const isCasePriority = (value: unknown): value is CasePriority => (CASE_PRIORITIES as readonly unknown[]).includes(value);

/** "Caso #5001". */
export const formatCaseNumber = (value: number | null | undefined) => (value ? `#${value}` : '#—');

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A subject for a case made from a conversation: the ticket's title, else what the customer said first, else who it is. */
export function suggestedSubject(input: { ticketTitle?: string | null; firstCustomerMessage?: string | null; contactName?: string | null; organizationName?: string | null }): string {
  const title = squeeze(input.ticketTitle ?? '');
  if (title) return cut(title, MAX_SUBJECT_LENGTH);
  const said = squeeze(input.firstCustomerMessage ?? '');
  if (said) return cut(said, 80);
  const who = squeeze(input.contactName ?? '') || squeeze(input.organizationName ?? '');
  return who ? `Conversa com ${who}` : 'Conversa sem resolução';
}

export type TranscriptMessage = { direction: 'in' | 'out'; body: string; kind?: string; autoKey?: string | null };

/** The end of a conversation as text ("Cliente: …" / "Equipe: …"), to start the description of a case. */
export function transcript(messages: TranscriptMessage[], who: string, max = 12): string {
  const lines = messages
    .filter((message) => message.kind !== 'system' && message.body.trim())
    .slice(-max)
    .map((message) => `${message.direction === 'in' ? who || 'Cliente' : message.autoKey ? 'Equipe (automática)' : 'Equipe'}: ${squeeze(message.body)}`);
  return cut(lines.join('\n'), MAX_DESCRIPTION_LENGTH);
}

/** The problem with the text of a note or description (null when fine). */
export function textProblem(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return required ? `Escreva ${label}.` : null;
  if (typeof value !== 'string') return `${label[0].toUpperCase()}${label.slice(1)} inválido.`;
  if (value.trim().length > max) return `${label[0].toUpperCase()}${label.slice(1)} pode ter até ${max} caracteres.`;
  return null;
}

/** The line the history shows when a field of a case changes. */
export const changeLine = {
  status: (from: CaseStatus, to: CaseStatus) => `Status: ${CASE_STATUS_LABELS[from]} → ${CASE_STATUS_LABELS[to]}`,
  priority: (from: CasePriority, to: CasePriority) => `Prioridade: ${CASE_PRIORITY_LABELS[from]} → ${CASE_PRIORITY_LABELS[to]}`,
  owner: (from: string | null, to: string | null) => (to ? `Responsável: ${from ?? 'ninguém'} → ${to}` : `Responsável removido (era ${from ?? 'ninguém'})`),
  subject: (to: string) => `Assunto alterado para “${to}”`,
};

/**
 * A resolved case must not be worked as if open: moving from "resolved" to any other status reopens it, and the history says so.
 * Returns the history line for a status change, with the reopening noted.
 */
export function statusLine(from: CaseStatus, to: CaseStatus): string {
  return from === 'resolved' && to !== 'resolved' ? `${changeLine.status(from, to)} (caso reaberto)` : changeLine.status(from, to);
}
