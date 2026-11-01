import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { callPortoWorker } from '@/lib/porto-worker-client';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin' || !auth.organizationId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'porto');
  if (featureBlocked) return featureBlocked;

  try {
    const { status, body } = await callPortoWorker(auth.organizationId, '/test-login', { method: 'POST' });

    // The screen shows "conectado" or "recusou o login" from this, without trying again every time it opens.
    const ok = status >= 200 && status < 300;
    const message = String((body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error ?? '').slice(0, 300);
    await sql`
      UPDATE porto_config
      SET last_login_test_at = NOW(), last_login_test_ok = ${ok}, last_login_test_message = ${message || null}
      WHERE organization_id = ${auth.organizationId}
    `.catch((error) => console.error('[porto-config/test-login] could not record the result:', error));

    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[porto-config/test-login] proxy error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
