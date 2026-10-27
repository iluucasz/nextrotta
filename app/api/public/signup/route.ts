import { NextRequest, NextResponse } from 'next/server';
import { PlatformError } from '@/lib/platform/errors';
import { checkSlugAvailability } from '@/lib/platform/organizations';
import { BILLING_DAYS, quoteSignup, signUp } from '@/lib/signup';
import { organizationUrl } from '@/lib/tenant-host';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = (error: unknown, fallback: string) => {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[public/signup] error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
};

/**
 * Checkout helpers for the site: `?slug=` checks an address; `?plan=&cycle=&billingDay=` returns
 * what is charged today (setup fee) and the first recurring charge (next month, on the chosen day).
 * For the builder plan ("montagem") add `&modules=porto,whatsapp`: the answer lists each module's price.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const slug = params.get('slug');
    if (slug !== null) {
      const result = await checkSlugAvailability(slug);
      return NextResponse.json({ slug: result.slug, available: result.available, reason: result.reason ?? null });
    }
    const modules = (params.get('modules') ?? '').split(',').map((key) => key.trim()).filter(Boolean);
    const quote = await quoteSignup(params.get('plan'), params.get('cycle'), params.get('billingDay') ?? BILLING_DAYS[1], modules);
    return NextResponse.json({
      plan: { key: quote.plan.key, name: quote.plan.name, description: quote.plan.description, includedTechnicians: quote.plan.includedTechnicians },
      cycle: quote.cycle,
      billingDay: quote.billingDay,
      billingDays: BILLING_DAYS,
      basePrice: quote.basePrice,
      modules: quote.moduleDetails.map((module) => ({ key: module.key, name: module.name, price: module.price, setupFee: module.setupFee })),
      setupFee: quote.setupFee,
      recurring: quote.recurring,
      firstDueDate: quote.firstDueDate,
    });
  } catch (error) {
    return failure(error, 'Não foi possível carregar agora.');
  }
}

/** Creates the company's account (self-service) and returns where to continue: its own subdomain, already logged in. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Envio inválido.' }, { status: 400 });

  const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip');
  try {
    const result = await signUp(body as Record<string, unknown>, sourceIp ?? null);
    const response = NextResponse.json(
      { success: true, slug: result.slug, redirectTo: organizationUrl(result.slug, `/api/auth/handoff?code=${encodeURIComponent(result.code)}`, request) },
      { status: 201 },
    );
    // Same as a login: /login on the root domain sends this browser straight to the company.
    response.cookies.set({
      name: 'last-organization',
      value: result.slug,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return response;
  } catch (error) {
    return failure(error, 'Não foi possível concluir a contratação agora. Tente de novo ou fale com a gente.');
  }
}
