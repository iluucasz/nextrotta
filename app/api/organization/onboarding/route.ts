import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { PlatformError } from '@/lib/platform/errors';
import { checkSetupPayment, getOnboarding, retrySetupCharge } from '@/lib/signup';
import { getSupportContact } from '@/lib/support-contact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = (error: unknown) => {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[organization/onboarding] error:', error);
  return NextResponse.json({ error: 'Não foi possível carregar agora.' }, { status: 500 });
};

/** Where a company that subscribed on the site stands: setup fee, preparation, first charge. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    // "Já paguei, verificar" (?check=1) asks the gateway right away; the page's polling is throttled.
    await checkSetupPayment(auth.organizationId, request.nextUrl.searchParams.get('check') === '1');
    const [onboarding, support] = await Promise.all([getOnboarding(auth.organizationId), getSupportContact()]);
    return NextResponse.json({ ...onboarding, support, isAdmin: auth.role === 'admin' });
  } catch (error) {
    return failure(error);
  }
}

/** Generates the setup-fee charge again (the first attempt failed, or the charge was canceled). */
export async function POST(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Apenas o administrador.' }, { status: 403 });
  try {
    const [onboarding, support] = await Promise.all([retrySetupCharge(auth.organizationId), getSupportContact()]);
    return NextResponse.json({ ...onboarding, support, isAdmin: true });
  } catch (error) {
    return failure(error);
  }
}
