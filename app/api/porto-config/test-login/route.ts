import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { callPortoWorker } from '@/lib/porto-worker-client';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { sql } from '@/lib/db';
import { notifyOrganization, resolveNotifications } from '@/lib/notifications';
import { describePortoError } from '@/lib/porto-login-errors';

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
    const raw = String((body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error ?? '');
    // The worker (an older one included) may send the technical trace; the company only gets the sentence.
    const { message, technical } = ok ? { message: raw, technical: null } : describePortoError(raw);
    if (!ok && technical) console.error('[porto-config/test-login] login failed:', auth.organizationId, technical);
    await sql`
      UPDATE porto_config
      SET last_login_test_at = NOW(), last_login_test_ok = ${ok}, last_login_test_message = ${message.slice(0, 300) || null}
      WHERE organization_id = ${auth.organizationId}
    `.catch((error) => console.error('[porto-config/test-login] could not record the result:', error));

    if (ok) {
      // A working login takes the "does not work" entry off the bell and says so once a day.
      await resolveNotifications(auth.organizationId, 'porto:login:').catch(() => undefined);
      await notifyOrganization(auth.organizationId, {
        kind: 'porto',
        severity: 'success',
        title: 'Login no Porto funcionando',
        body: 'O robô conseguiu entrar no Portal do Prestador com o CPF e a senha cadastrados.',
        href: '/admin/config-porto',
        dedupeKey: `porto:login-ok:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    return NextResponse.json(ok ? body : { error: message }, { status });
  } catch (error) {
    console.error('[porto-config/test-login] proxy error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
