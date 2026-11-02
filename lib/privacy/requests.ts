import { createHash } from 'node:crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from '../platform/errors';
import { sendOwnerAlert } from '../platform/alerts';
import { REQUEST_KIND_LABELS } from './labels';

// Requests from the people the data is about (LGPD, art. 18): access, correction, anonymization, deletion, portability...
// The law gives 15 days to answer (art. 19, II), so every request carries its due date. NextRotta is the processor of the
// employees' data a company registers and the controller of the account data: the owner decides, on each request, whether to
// answer it directly or forward it to the company that holds the data — and records the answer here.

export const REQUEST_KINDS = ['access', 'correction', 'anonymization', 'deletion', 'portability', 'information', 'revocation', 'objection', 'other'] as const;
export const REQUEST_STATUSES = ['received', 'in_progress', 'answered', 'rejected'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export { REQUEST_KIND_LABELS };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Requests accepted per sender per hour on the public form. */
const MAX_PER_HOUR = 5;

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The public form. `website` is a honeypot: a bot that fills it is silently dropped. */
export async function submitPrivacyRequest(input: Record<string, unknown>, sourceIp: string | null) {
  if (clip(input.website, 200)) return { accepted: true };

  const name = clip(input.name, 120);
  const email = clip(input.email, 200).toLowerCase();
  const kind = REQUEST_KINDS.includes(input.kind as RequestKind) ? (input.kind as RequestKind) : null;
  const message = clip(input.message, 4000);
  const organizationHint = clip(input.organization, 160);

  if (!name) throw new PlatformError('Informe seu nome.');
  if (!EMAIL_PATTERN.test(email)) throw new PlatformError('Informe um e-mail válido, para onde enviaremos a resposta.');
  if (!kind) throw new PlatformError('Escolha o tipo de pedido.');
  if (message.length < 10) throw new PlatformError('Conte o que você precisa, em pelo menos uma frase.');

  const sourceHash = sourceIp ? createHash('sha256').update(`nextrotta-privacy:${sourceIp}`).digest('hex') : null;
  if (sourceHash) {
    const recent = await sql`
      SELECT COUNT(*)::int AS total FROM data_subject_requests WHERE source_hash = ${sourceHash} AND received_at > NOW() - INTERVAL '1 hour'
    `;
    if (Number(recent[0].total) >= MAX_PER_HOUR) {
      throw new PlatformError('Recebemos vários pedidos seus agora há pouco. Tente de novo mais tarde.', 429);
    }
  }

  const rows = await sql`
    INSERT INTO data_subject_requests (requester_name, requester_email, organization_hint, kind, message, source_hash)
    VALUES (${name}, ${email}, ${organizationHint || null}, ${kind}, ${message}, ${sourceHash})
    RETURNING id, due_at
  `;
  // The owner is told right away: the deadline starts counting when the request arrives.
  void sendOwnerAlert({
    key: `privacy:${rows[0].id}`,
    kind: 'privacy_request',
    title: 'Novo pedido de titular de dados (LGPD)',
    lines: [`${REQUEST_KIND_LABELS[kind]}`, `De: ${name}`, `Prazo para responder: ${new Date(rows[0].due_at as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`],
  });
  return { accepted: true };
}

export async function listPrivacyRequests() {
  const rows = await sql`
    SELECT r.id, r.requester_name AS "name", r.requester_email AS "email", r.organization_hint AS "organizationHint",
           r.organization_id AS "organizationId", o.name AS "organizationName", r.kind, r.message, r.status,
           r.received_at AS "receivedAt", r.due_at AS "dueAt", r.answered_at AS "answeredAt", r.response_note AS "responseNote"
    FROM data_subject_requests r
    LEFT JOIN organizations o ON o.id = r.organization_id
    ORDER BY (r.status IN ('answered', 'rejected')), r.due_at ASC
  `;
  return rows.map((row) => ({
    ...row,
    id: String(row.id),
    kindLabel: REQUEST_KIND_LABELS[row.kind as RequestKind] ?? String(row.kind),
    overdue: !['answered', 'rejected'].includes(String(row.status)) && new Date(row.dueAt as string).getTime() < Date.now(),
  }));
}

/** { status?, organizationId?, responseNote? } — the owner moves the request forward and records the answer. */
export async function updatePrivacyRequest(requestId: string, input: Record<string, unknown>, actor: Actor) {
  if (!isUuid(requestId)) throw new PlatformError('Pedido não encontrado.', 404);
  const current = await sql`SELECT id, status, response_note FROM data_subject_requests WHERE id = ${requestId}`;
  if (!current[0]) throw new PlatformError('Pedido não encontrado.', 404);

  const status = input.status === undefined ? String(current[0].status) : String(input.status);
  if (!REQUEST_STATUSES.includes(status as RequestStatus)) throw new PlatformError('Situação inválida.');
  const note = input.responseNote === undefined ? undefined : clip(input.responseNote, 4000);
  const closing = status === 'answered' || status === 'rejected';
  if (closing && !(note ?? String(current[0].response_note ?? '')).trim()) throw new PlatformError('Registre o que foi respondido ao titular.');
  const organizationId = input.organizationId === undefined ? undefined : input.organizationId === null ? null : String(input.organizationId);
  if (organizationId && !isUuid(organizationId)) throw new PlatformError('Empresa inválida.');

  await sql`
    UPDATE data_subject_requests SET
      status = ${status},
      organization_id = CASE WHEN ${organizationId !== undefined} THEN ${organizationId ?? null} ELSE organization_id END,
      response_note = CASE WHEN ${note !== undefined} THEN ${note ?? null} ELSE response_note END,
      answered_at = CASE WHEN ${closing} THEN COALESCE(answered_at, NOW()) ELSE NULL END,
      answered_by = CASE WHEN ${closing} THEN COALESCE(answered_by, ${actor.id}) ELSE NULL END
    WHERE id = ${requestId}
  `;
  await recordAudit({
    organizationId: organizationId ?? null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'privacy_request.updated',
    targetType: 'data_subject_request',
    targetId: requestId,
    details: { status, organizationId: organizationId ?? undefined },
  });
  return (await listPrivacyRequests()).find((item) => item.id === requestId);
}
