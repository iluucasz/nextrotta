// No dependencies on the database or the framework: used by the routes, the panel and the tests.
// The cases of the team. A case is ONE kind of record: Suporte, Bug and Sugestão are its types (lib/reports.ts has the types, the
// status words of each type and the support categories). This file adds what a case from a conversation needs: where it came from,
// what it starts with, and the lines of its history.
import { reportStatusLabels, REPORT_TYPES, type ReportType } from '../reports';

export const CASE_STATUSES = ['new', 'investigating', 'waiting', 'resolved', 'not_reproduced'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
/** Statuses that still ask for work. */
export const OPEN_STATUSES: readonly CaseStatus[] = ['new', 'investigating', 'waiting'];
export const isOpenStatus = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

/** The words of the statuses for a type of case (the same ones the customer sees on their ticket). */
export const caseStatusLabel = (type: ReportType, status: CaseStatus) => reportStatusLabels(type)[status];

export const CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

/** Where a case came from. "portal" is what the customer opened in their own system. */
export const CASE_ORIGINS = ['portal', 'livechat', 'whatsapp', 'manual'] as const;
export type CaseOrigin = (typeof CASE_ORIGINS)[number];
export const CASE_ORIGIN_LABELS: Record<CaseOrigin, string> = { portal: 'Sistema do cliente', livechat: 'Chat ao vivo', whatsapp: 'WhatsApp', manual: 'Criado à mão' };

export const MAX_SUBJECT_LENGTH = 140;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_NOTE_LENGTH = 2000;

export const isCaseStatus = (value: unknown): value is CaseStatus => (CASE_STATUSES as readonly unknown[]).includes(value);
export const isCasePriority = (value: unknown): value is CasePriority => (CASE_PRIORITIES as readonly unknown[]).includes(value);
export const isCaseType = (value: unknown): value is ReportType => (REPORT_TYPES as readonly unknown[]).includes(value);

/** "#1024". */
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

/** The lines the history shows when a field of a case changes. */
export const changeLine = {
  priority: (from: CasePriority, to: CasePriority) => `Prioridade: ${CASE_PRIORITY_LABELS[from]} → ${CASE_PRIORITY_LABELS[to]}`,
  owner: (from: string | null, to: string | null) => (to ? `Responsável: ${from ?? 'ninguém'} → ${to}` : `Responsável removido (era ${from ?? 'ninguém'})`),
  subject: (to: string) => `Assunto alterado para “${to}”`,
};

/** The history line for a status change, in the words of the case's type; leaving "resolved" says the case was reopened. */
export function statusLine(type: ReportType, from: CaseStatus, to: CaseStatus): string {
  const line = `Status: ${caseStatusLabel(type, from)} → ${caseStatusLabel(type, to)}`;
  const closed = from === 'resolved' || from === 'not_reproduced';
  return closed && !(to === 'resolved' || to === 'not_reproduced') ? `${line} (caso reaberto)` : line;
}
