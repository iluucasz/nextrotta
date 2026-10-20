import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { callPortoWorker } from '@/lib/porto-worker-client';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Real login + fetch of Porto's own socorristas list, proxied to the VPS worker (see
 * worker/server.ts) — feeds the "Match de técnicos" modal (admin/config-porto) where an admin
 * manually confirms which local technician each Porto QRA corresponds to.
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin' || !auth.organizationId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'porto');
  if (featureBlocked) return featureBlocked;

  try {
    const { status, body } = await callPortoWorker(auth.organizationId, '/socorristas', { method: 'POST' });
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[porto-config/socorristas] proxy error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
