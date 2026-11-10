import { randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { syncSubscriptionValueQuietly } from '@/lib/billing/billing';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { sql } from '@/lib/db';
import { notifyOrganization } from '@/lib/notifications';
import { getOrganizationSettings } from '@/lib/organization-settings-store';
import { MAX_PORTO_IMPORT, planPortoImport, type PortoCandidate } from '@/lib/porto-technician-import';

export const runtime = 'nodejs';

/**
 * Creates technicians from the socorristas the admin picked in "Importar do Porto" (the list itself
 * comes from /api/porto-config/socorristas). They start without a login — Porto has no e-mail — with
 * the QRA and the Porto name set, which is what the hours import needs to find them; pay values are
 * the organization's defaults. A QRA that an active technician already holds is skipped, not an error.
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin' || !auth.organizationId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const organizationId = auth.organizationId;

  const featureBlocked = await blockUnlessFeature(organizationId, 'porto');
  if (featureBlocked) return featureBlocked;

  const body = await request.json().catch(() => null);
  const candidates: PortoCandidate[] = Array.isArray(body?.socorristas) ? body.socorristas : [];
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'Selecione pelo menos um técnico do Porto.' }, { status: 400 });
  }
  if (candidates.length > MAX_PORTO_IMPORT) {
    return NextResponse.json({ error: `Importe até ${MAX_PORTO_IMPORT} técnicos por vez.` }, { status: 400 });
  }

  try {
    const activeRows = await sql`
      SELECT qra FROM technicians
      WHERE organization_id = ${organizationId} AND qra IS NOT NULL AND status = 'active' AND deleted_at IS NULL
    `;
    const { toCreate, skipped } = planPortoImport(candidates, new Set(activeRows.map((row) => String(row.qra))));

    if (toCreate.length > 0) {
      const defaults = await getOrganizationSettings(organizationId);
      // All or nothing: a failure in one row must not leave half the list created.
      await sql.transaction(
        toCreate.map(
          (item) => sql`
            INSERT INTO technicians (
              organization_id, qra, name, porto_name_hint, status,
              commission_percentage, commission_rate, base_salary, va_allowance, vr_allowance
            )
            VALUES (
              ${organizationId}, ${item.qra}, ${item.name}, ${item.portoName}, ${item.status},
              ${defaults.commissionPercentage}, ${defaults.commissionRate}, ${defaults.baseSalary},
              ${defaults.vaAllowance}, ${defaults.vrAllowance}
            )
          `,
        ),
      );

      after(() => syncSubscriptionValueQuietly(organizationId));
      after(() =>
        notifyOrganization(organizationId, {
          kind: 'technician',
          severity: 'success',
          title: 'Técnicos importados do Porto',
          body: `${toCreate.length} técnico(s) cadastrado(s) pelo Porto. Complete o e-mail e a senha em Técnicos para quem for entrar no sistema.`,
          href: '/admin/technicians',
          dedupeKey: `technician:porto-import:${randomUUID()}`,
        }),
      );
    }

    return NextResponse.json({ created: toCreate.length, skipped }, { status: toCreate.length ? 201 : 200 });
  } catch (error) {
    // technicians_active_qra_idx: someone registered the same QRA between the check and the insert.
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Algum desses QRAs acabou de ser cadastrado. Atualize a lista e tente de novo.' }, { status: 409 });
    }
    console.error('[technicians/import-porto] error:', error);
    return NextResponse.json({ error: 'Não foi possível importar os técnicos.' }, { status: 500 });
  }
}
