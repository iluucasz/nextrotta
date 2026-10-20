import { NextRequest, NextResponse } from 'next/server';
import { getAiBalance } from '@/lib/ai/balance';
import { PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?month=AAAA-MM — DeepSeek balance now (read at most every 5 min), what it charged and what was topped up in the month. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const month =
      request.nextUrl.searchParams.get('month') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PlatformError('Mês inválido (use AAAA-MM).');
    return NextResponse.json(await getAiBalance(month));
  });
}
