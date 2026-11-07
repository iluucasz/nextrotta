import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { isNoticeCategory, isNoticeSeverity } from '@/lib/platform/notice-meta';
import { runPlatformChecks } from '@/lib/platform/notice-checks';
import { clearNotices, listNotices, markNoticesRead, summarizeNotices, type NoticeFilters } from '@/lib/platform/notices';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** How often a person's open panel may start the platform checks (the worker runs them every 30 minutes anyway). */
const LAZY_CHECK_INTERVAL_MS = 10 * 60_000;

function filtersFrom(source: Record<string, unknown>): NoticeFilters {
  const filters: NoticeFilters = {};
  if (source.state === 'cleared') filters.state = 'cleared';
  if (isNoticeSeverity(source.severity)) filters.severity = source.severity;
  if (isNoticeCategory(source.category)) filters.category = source.category;
  if (isUuid(source.organizationId)) filters.organizationId = source.organizationId;
  if (source.resolved === true || source.resolved === '1') filters.includeResolved = true;
  if (source.unread === true || source.unread === '1') filters.unreadOnly = true;
  return filters;
}

/**
 * The inbox of the NextRotta's people. The owner sees everything; a support user only what is for the whole staff (cases, chats).
 * ?state=active|cleared &severity= &category= &organizationId= &resolved=1 &unread=1 &limit= &offset= &summary=1 (only the counters)
 * &check=1 (the open panel asks the platform checks to run, at most every 10 minutes, after answering).
 */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async (staff) => {
    const params = request.nextUrl.searchParams;
    const viewer = { userId: staff.userId, role: staff.role };

    // Only the real deployment: a development machine pointed at the shared database must not raise (or send WhatsApp about) incidents
    // that are only its own settings.
    if (params.get('check') === '1' && process.env.VERCEL_ENV === 'production') {
      after(async () => {
        await runPlatformChecks({ minIntervalMs: LAZY_CHECK_INTERVAL_MS }).catch((error) => console.error('[platform-notices] lazy checks:', error));
      });
    }

    const summary = await summarizeNotices(viewer);
    if (params.get('summary') === '1') return NextResponse.json({ summary });

    const filters = filtersFrom(Object.fromEntries(params.entries()));
    const limit = Number(params.get('limit')) || 50;
    const offset = Number(params.get('offset')) || 0;
    const items = await listNotices(viewer, filters, { limit: limit + 1, offset });
    return NextResponse.json({ items: items.slice(0, limit), hasMore: items.length > limit, summary });
  });
}

/**
 * { action: "read" | "clear" | "restore", ids?: string[], all?: true, filters?: { severity, category, organizationId, state } }
 * Always for the person who asks (reading or clearing never changes what the others see).
 */
export async function POST(request: NextRequest) {
  return withPlatformStaff(request, async (staff) => {
    const body = await readJson(request);
    const viewer = { userId: staff.userId, role: staff.role };
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : undefined;
    const target = { ids, all: body.all === true, filters: filtersFrom((body.filters ?? {}) as Record<string, unknown>) };
    if (!ids && !target.all) throw new PlatformError('Diga quais notificações (ids) ou use all.');

    if (body.action === 'read') return NextResponse.json({ changed: await markNoticesRead(viewer, target) });
    if (body.action === 'clear') return NextResponse.json({ changed: await clearNotices(viewer, target) });
    if (body.action === 'restore') return NextResponse.json({ changed: await clearNotices(viewer, target, true) });
    throw new PlatformError('Ação inválida.');
  });
}
