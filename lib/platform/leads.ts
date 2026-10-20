import { createHash } from 'node:crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from './errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGINS = ['contratar', 'sob_medida', 'contato'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'proposal', 'won', 'lost'] as const;
/** Submissions accepted per sender per hour on the public form. */
const MAX_PER_HOUR = 5;

function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * A submission of the site's contact forms. `website` is a honeypot field that's hidden from
 * people: when a bot fills it, the submission is silently dropped.
 */
export async function submitLead(input: Record<string, unknown>, sourceIp: string | null) {
  if (clip(input.website, 200)) return { accepted: true };

  const name = clip(input.name, 120);
  const company = clip(input.company, 160);
  const email = clip(input.email, 200).toLowerCase();
  const origin = ORIGINS.includes(input.origin as (typeof ORIGINS)[number]) ? (input.origin as string) : 'contato';
  const message = clip(input.message, 4000);

  if (!name || !company) throw new PlatformError('Informe seu nome e o nome da empresa.');
  if (!EMAIL_PATTERN.test(email)) throw new PlatformError('Informe um e-mail válido.');
  if (origin === 'sob_medida' && !message) throw new PlatformError('Conte o que você precisa.');

  const technicians = Number(input.technicians);
  const sourceHash = sourceIp ? createHash('sha256').update(`nextrotta-lead:${sourceIp}`).digest('hex') : null;

  if (sourceHash) {
    const recent = await sql`
      SELECT COUNT(*)::int AS total FROM leads WHERE source_hash = ${sourceHash} AND created_at > NOW() - INTERVAL '1 hour'
    `;
    if (Number(recent[0].total) >= MAX_PER_HOUR) {
      throw new PlatformError('Recebemos várias mensagens suas agora há pouco. Tente de novo mais tarde ou fale pelo WhatsApp.', 429);
    }
  }

  await sql`
    INSERT INTO leads (name, company, email, phone, technicians, plan_key, cycle, message, origin, source_hash)
    VALUES (
      ${name}, ${company}, ${email}, ${clip(input.phone, 40) || null},
      ${Number.isFinite(technicians) && technicians >= 0 ? Math.round(technicians) : null},
      ${clip(input.plan, 40) || null}, ${input.cycle === 'annual' ? 'annual' : input.cycle === 'monthly' ? 'monthly' : null},
      ${message || null}, ${origin}, ${sourceHash}
    )
  `;
  return { accepted: true };
}

export async function listLeads() {
  return sql`
    SELECT l.id, l.name, l.company, l.email, l.phone, l.technicians, l.plan_key AS "planKey", p.name AS "planName",
           l.cycle, l.message, l.origin, l.status, l.organization_id AS "organizationId", l.created_at AS "createdAt",
           (SELECT COUNT(*)::int FROM lead_notes n WHERE n.lead_id = l.id) AS "notesCount"
    FROM leads l
    LEFT JOIN plans p ON p.key = l.plan_key
    WHERE l.deleted_at IS NULL
    ORDER BY l.created_at DESC
  `;
}

async function requireLead(leadId: string) {
  if (!isUuid(leadId)) throw new PlatformError('Lead não encontrado.', 404);
  const rows = await sql`
    SELECT l.*, p.id AS plan_id, p.name AS plan_name
    FROM leads l LEFT JOIN plans p ON p.key = l.plan_key
    WHERE l.id = ${leadId} AND l.deleted_at IS NULL
  `;
  if (!rows[0]) throw new PlatformError('Lead não encontrado.', 404);
  return rows[0];
}

export async function getLead(leadId: string) {
  const lead = await requireLead(leadId);
  const notes = await sql`
    SELECT n.id, n.text, n.created_at AS "createdAt", u.name AS "authorName"
    FROM lead_notes n JOIN users u ON u.id = n.author_id
    WHERE n.lead_id = ${leadId}
    ORDER BY n.created_at DESC
  `;
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    technicians: lead.technicians,
    planKey: lead.plan_key,
    planId: lead.plan_id,
    planName: lead.plan_name,
    cycle: lead.cycle,
    message: lead.message,
    origin: lead.origin,
    status: lead.status,
    organizationId: lead.organization_id,
    createdAt: lead.created_at,
    notes,
  };
}

export async function updateLead(leadId: string, input: Record<string, unknown>, actor: Actor) {
  const lead = await requireLead(leadId);
  if (input.status !== undefined) {
    if (!LEAD_STATUSES.includes(input.status as (typeof LEAD_STATUSES)[number])) throw new PlatformError('Estado inválido.');
    await sql`UPDATE leads SET status = ${input.status as string}, updated_at = NOW() WHERE id = ${leadId}`;
    await recordAudit({
      organizationId: null,
      actorId: actor.id,
      actorRole: 'platform_owner',
      action: 'lead.updated',
      targetType: 'lead',
      targetId: leadId,
      details: { status: { from: lead.status, to: input.status } },
    });
  }
  if (typeof input.note === 'string' && input.note.trim()) {
    await sql`INSERT INTO lead_notes (lead_id, author_id, text) VALUES (${leadId}, ${actor.id}, ${input.note.trim().slice(0, 4000)})`;
  }
  return getLead(leadId);
}

/** Called when an organization is created from a lead: the lead is won and points to it. */
export async function markLeadConverted(leadId: string, organizationId: string, actor: Actor) {
  if (!isUuid(leadId)) return;
  await sql`
    UPDATE leads SET status = 'won', organization_id = ${organizationId}, updated_at = NOW()
    WHERE id = ${leadId} AND deleted_at IS NULL
  `;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'lead.converted',
    targetType: 'lead',
    targetId: leadId,
  });
}
