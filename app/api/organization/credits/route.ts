import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { buyCreditPackage } from '@/lib/billing/billing';
import { getOrganizationCredits, listCreditPackages } from '@/lib/platform/ai-credits';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

/** The admin's view of the AI credits: balance, statement and packages for sale. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const [credits, packages] = await Promise.all([getOrganizationCredits(auth.organizationId), listCreditPackages({ activeOnly: true })]);
    return NextResponse.json({ ...credits, packages: packages.map(({ id, name, credits: amount, price }) => ({ id, name, credits: amount, price })) });
  } catch (error) {
    console.error('[organization/credits] error:', error);
    return NextResponse.json({ error: 'Erro ao carregar os créditos.' }, { status: 500 });
  }
}

/** { packageId } — issues the charge; the credits arrive once it's paid. */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (typeof body?.packageId !== 'string') return NextResponse.json({ error: 'Escolha um pacote.' }, { status: 400 });
    return NextResponse.json(await buyCreditPackage(auth.organizationId, body.packageId, auth.userId));
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/credits] error:', error);
    return NextResponse.json({ error: 'Não foi possível gerar a cobrança.' }, { status: 500 });
  }
}
