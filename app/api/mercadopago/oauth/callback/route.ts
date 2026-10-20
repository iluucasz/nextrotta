import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { finishConnection } from '@/lib/mercadopago/accounts';
import { organizationUrl, rootUrl } from '@/lib/tenant-host';

export const runtime = 'nodejs';

const RETURN_PATH = '/dashboard/pecas';

/**
 * Where Mercado Pago sends the technician back after authorizing (one fixed URL on the root domain,
 * public in middleware: the session lives on the subdomain). The state says who started it; the
 * technician then goes back to their organization's screen.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  const code = params.get('code');

  const origin = state
    ? (
        await sql`
          SELECT o.slug FROM mercadopago_oauth_states s JOIN organizations o ON o.id = s.organization_id
          WHERE s.state = ${state}
        `
      )[0]
    : null;
  const back = (query: string) =>
    NextResponse.redirect(origin ? organizationUrl(String(origin.slug), `${RETURN_PATH}?${query}`, request) : rootUrl('/login', request));

  if (!code) {
    // Denied on Mercado Pago's screen (or an incomplete return).
    return back('mp=cancelado');
  }

  try {
    const { slug } = await finishConnection(state, code);
    return NextResponse.redirect(organizationUrl(slug, `${RETURN_PATH}?mp=conectado`, request));
  } catch (error) {
    console.error('[mercadopago] oauth callback:', error);
    const message = error instanceof Error ? error.message : 'Não foi possível conectar.';
    return back(`mp=erro&motivo=${encodeURIComponent(message.slice(0, 200))}`);
  }
}
