import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { resendMessage } from '@/lib/whatsapp/notifications';
import { MESSAGE_STATUSES, NOTIFICATION_TYPES } from '@/lib/whatsapp/notification-types';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE_SIZE = 50;
/** Ceiling for a single export, so one click can't pull an unbounded table into the browser. */
const EXPORT_LIMIT = 20_000;

function listParam(searchParams: URLSearchParams, key: string) {
  return (searchParams.get(key) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * History with filters. Dates filter on when the message was sent, in Brasília time. `export=1`
 * returns every matching row (up to EXPORT_LIMIT) instead of one page.
 */
export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const { searchParams } = new URL(request.url);
    const params: unknown[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [`m.organization_id = ${addParam(auth.organizationId)}`, 'm.deleted_at IS NULL'];

    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const sentDate = `(m.created_at AT TIME ZONE 'America/Sao_Paulo')::date`;

    if (start && DATE_KEY_PATTERN.test(start)) conditions.push(`${sentDate} >= ${addParam(start)}::date`);
    if (end && DATE_KEY_PATTERN.test(end)) conditions.push(`${sentDate} <= ${addParam(end)}::date`);

    const technicianIds = listParam(searchParams, 'technicianIds');
    if (technicianIds.length) conditions.push(`m.technician_id = ANY(${addParam(technicianIds)}::text[])`);

    const allowedTypes: string[] = [...NOTIFICATION_TYPES, 'test', 'parts_sale'];
    const types = listParam(searchParams, 'types').filter((type) => allowedTypes.includes(type));
    if (types.length) conditions.push(`m.type = ANY(${addParam(types)}::text[])`);

    const statuses = listParam(searchParams, 'statuses').filter((status) => (MESSAGE_STATUSES as readonly string[]).includes(status));
    if (statuses.length) conditions.push(`m.status = ANY(${addParam(statuses)}::text[])`);

    const where = `WHERE ${conditions.join(' AND ')}`;
    const isExport = searchParams.get('export') === '1';
    const pageSize = isExport ? EXPORT_LIMIT : DEFAULT_PAGE_SIZE;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const offset = isExport ? 0 : (page - 1) * pageSize;

    const [rows, totals] = await Promise.all([
      sql.query(
        `
          SELECT m.id, m.technician_id, COALESCE(t.name, m.technician_name) AS technician_name, m.phone, m.type,
                 m.trigger_kind, to_char(m.reference_date, 'YYYY-MM-DD') AS reference_date, m.message, m.status,
                 m.error, m.redirected_to_test, m.created_at, m.sent_at
          FROM whatsapp_messages m
          LEFT JOIN technicians t ON t.id::text = m.technician_id
          ${where}
          ORDER BY m.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
        params,
      ),
      sql.query(
        `
          SELECT m.status, COUNT(*)::int AS total
          FROM whatsapp_messages m
          ${where}
          GROUP BY m.status
        `,
        params,
      ),
    ]);

    const byStatus = Object.fromEntries(totals.map((row) => [String(row.status), Number(row.total)]));
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

    return NextResponse.json({
      messages: rows,
      total,
      byStatus,
      page,
      pageSize,
      truncated: isExport && total > EXPORT_LIMIT,
    });
  } catch (error) {
    console.error('[whatsapp/messages] GET error:', error);
    return NextResponse.json({ error: 'Erro ao carregar o histórico.' }, { status: 500 });
  }
}

/** Resends one history row. */
export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';

    if (body?.action !== 'resend' || !id) {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }

    const result = await resendMessage(auth.organizationId, id, auth.userId);

    if (!result) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
    if (result.outcome !== 'sent') {
      return NextResponse.json({ error: result.error ?? 'Não foi possível reenviar.' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[whatsapp/messages] POST error:', error);
    return NextResponse.json({ error: 'Erro ao reenviar a mensagem.' }, { status: 500 });
  }
}
