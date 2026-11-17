import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { CERTIFICATE_DOCUMENTS, generateAcceptanceCertificate, listCertificates } from '@/lib/legal/certificate';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function organizationId(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
  return id;
}

/** What the company accepted (every acceptance, with who and from where) and the certificates kept in its Biblioteca. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const id = await organizationId(context);
    const [acceptances, certificates] = await Promise.all([
      sql`
        SELECT a.document, a.version, a.accepted_at, a.source, a.ip, u.name AS who, u.email
        FROM legal_acceptances a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.organization_id = ${id}
        ORDER BY a.accepted_at DESC, a.document
      `,
      listCertificates(id),
    ]);
    const accepted = new Set(acceptances.map((row) => String(row.document)));
    return NextResponse.json({
      acceptances: acceptances.map((row) => ({
        key: `${row.document}:${row.version}:${new Date(row.accepted_at as string).toISOString()}`,
        document: String(row.document),
        version: String(row.version),
        acceptedAt: new Date(row.accepted_at as string).toISOString(),
        source: String(row.source),
        ip: (row.ip as string | null) ?? null,
        who: (row.who as string | null) ?? null,
        email: (row.email as string | null) ?? null,
      })),
      certificates,
      // A certificate needs the three documents of the agreement accepted.
      complete: CERTIFICATE_DOCUMENTS.every((document) => accepted.has(document)),
    });
  });
}

/** Makes the certificate now (replacing the one of the same version, which is archived). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const id = await organizationId(context);
    const result = await generateAcceptanceCertificate(id, { force: true, actorId: owner.userId });
    if (result.status === 'incomplete') throw new PlatformError('A empresa ainda não aceitou os três documentos (termos, privacidade e DPA).', 409);
    return NextResponse.json(result);
  });
}
