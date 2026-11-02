import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { verifyOrganizationAuth } from '@/lib/auth';
import { acceptancesOf, recordAcceptances } from '@/lib/legal/acceptance';
import { ACCOUNT_DOCUMENTS, LEGAL_DOCUMENTS, isLegalDocument, pendingDocuments, type LegalDocument } from '@/lib/legal/versions';
import { clientIp } from '@/lib/security/throttle';
import { rootUrl } from '@/lib/tenant-host';

export const runtime = 'nodejs';

/** The legal documents of the company's agreement: current versions, what was accepted, what is still to accept. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const accepted = await acceptancesOf(auth.organizationId);
    const documents = (Object.keys(LEGAL_DOCUMENTS) as LegalDocument[]).map((key) => {
      const current = accepted.find((item) => item.document === key && item.version === LEGAL_DOCUMENTS[key].version);
      return {
        key,
        title: LEGAL_DOCUMENTS[key].title,
        version: LEGAL_DOCUMENTS[key].version,
        url: rootUrl(LEGAL_DOCUMENTS[key].path, request),
        accepted: Boolean(current),
        acceptedAt: current?.acceptedAt ?? null,
      };
    });
    // The owner working inside the account, or an admin previewing, never accepts on the company's behalf.
    const exempt = Boolean(auth.impersonationId || auth.preview);
    return NextResponse.json({ documents, pending: exempt ? [] : pendingDocuments(accepted, ACCOUNT_DOCUMENTS) });
  } catch (error) {
    console.error('[organization/legal] error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os documentos.' }, { status: 500 });
  }
}

/** { documents: ["terms", ...] } — the admin accepts the current version of each. */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin' || auth.preview || auth.impersonationId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const requested: LegalDocument[] = Array.isArray(body?.documents) ? body.documents.filter(isLegalDocument) : [];
    if (!requested.length) return NextResponse.json({ error: 'Escolha os documentos que você aceita.' }, { status: 400 });

    const documents = [...new Set(requested)];
    await recordAcceptances({
      organizationId: auth.organizationId,
      userId: auth.userId,
      documents,
      ip: clientIp(request.headers),
      userAgent: request.headers.get('user-agent'),
      source: 'app',
    });
    await recordAudit({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: 'admin',
      action: 'legal.accepted',
      targetType: 'organization',
      targetId: auth.organizationId,
      details: { documents: documents.map((key) => ({ key, version: LEGAL_DOCUMENTS[key].version })) },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[organization/legal] accept error:', error);
    return NextResponse.json({ error: 'Não foi possível registrar o aceite.' }, { status: 500 });
  }
}
