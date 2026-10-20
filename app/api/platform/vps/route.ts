import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { getPlatformSettings } from '@/lib/platform/settings';
import { getNightCapacity, getVpsHost, getVpsMetricsHistory, vpsAgentConfigured, type MetricsRange } from '@/lib/platform/vps';

export const runtime = 'nodejs';

const RANGES: MetricsRange[] = ['24h', '7d', '30d'];

/** VPS overview: live host usage (from the agent), history, night capacity and the cleanup switch. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const rangeParam = request.nextUrl.searchParams.get('range') as MetricsRange | null;
    const range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : '24h';
    const configured = vpsAgentConfigured();
    const [host, history, capacity, settings] = await Promise.all([
      configured
        ? getVpsHost().then(
            (value) => ({ ok: true as const, value }),
            (error: Error) => ({ ok: false as const, error: error.message }),
          )
        : null,
      getVpsMetricsHistory(range),
      getNightCapacity(),
      getPlatformSettings(),
    ]);
    return NextResponse.json({
      agentConfigured: configured,
      host: host?.ok ? host.value : null,
      agentError: host && !host.ok ? host.error : null,
      range,
      history,
      capacity,
      autoCleanup: settings.vps.autoCleanup,
    });
  });
}
