import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { aggregateOperations, number, type ManagementData } from '@/lib/management-dashboard';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { getOrganizationSettings } from '@/lib/organization-settings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 });
    if (user.role !== 'admin')
      return NextResponse.json({ error: 'Acesso exclusivo para administradores.' }, { status: 403 });

    const rawYear = request.nextUrl.searchParams.get('year');
    if (!rawYear || !/^\d{4}$/.test(rawYear) || Number(rawYear) < 2000 || Number(rawYear) > 2100) {
      return NextResponse.json({ error: 'Informe um ano válido entre 2000 e 2100.' }, { status: 400 });
    }
    const year = Number(rawYear);
    const from = `${year - 1}-01`,
      until = `${year + 1}-01`;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const org = user.organization_id;
    if (!org) return NextResponse.json({ error: 'Acesso exclusivo para administradores.' }, { status: 403 });

    const featureBlocked = await blockUnlessFeature(org, 'management_dashboard');
    if (featureBlocked) return featureBlocked;

    // Archived technicians are kept in the list on purpose: their past production still belongs in
    // the history. Archived records of everything else are left out.
    const results = await Promise.allSettled([
      sql`SELECT id::text, name, qra, status FROM technicians WHERE organization_id = ${org} ORDER BY name`,
      sql`
        SELECT COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed, 'YYYY-MM')) AS month,
               technician_id::text AS technician_id, COALESCE(NULLIF(service_type, ''), 'Não informado') AS service_type,
               SUM(value) AS revenue, COUNT(*) AS count
        FROM services
        WHERE organization_id = ${org}
          AND deleted_at IS NULL
          AND COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed, 'YYYY-MM')) >= ${from}
          AND COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed, 'YYYY-MM')) < ${until}
        GROUP BY 1, 2, 3
      `,
      sql`
        SELECT DISTINCT ON (technician_id, competence_month)
          technician_id::text, competence_month AS month, status,
          net_total, advances_total, COALESCE(va_deduction, 0) + COALESCE(vr_deduction, 0) AS benefits
        FROM payroll p
        WHERE organization_id = ${org}
          AND deleted_at IS NULL
          AND competence_month >= ${from} AND competence_month < ${until}
        ORDER BY technician_id, competence_month, updated_at DESC NULLS LAST, created_at DESC, id
      `,
      sql`
        SELECT competence_month AS month, category, status, SUM(amount) AS amount,
          SUM(LEAST(amount, GREATEST(0, CASE WHEN status = 'paid' THEN amount ELSE COALESCE(paid_amount, 0) END))) AS paid
        FROM financial_entries f
        WHERE organization_id = ${org}
          AND deleted_at IS NULL
          AND type = 'payable' AND competence_month >= ${from} AND competence_month < ${until}
        GROUP BY 1, 2, 3
      `,
      sql`
        SELECT DISTINCT ON (technician_id, date) technician_id::text, TO_CHAR(date, 'YYYY-MM-DD') AS date,
          status, notes, start_time::text AS start, end_time::text AS end
        FROM schedule
        WHERE organization_id = ${org}
          AND deleted_at IS NULL
          AND date < ${until + '-01'}::date AND date <= ${today}::date
        ORDER BY technician_id, date, created_at DESC,
          CASE status WHEN 'scheduled' THEN 3 WHEN 'completed' THEN 2 ELSE 1 END DESC, id
      `,
      sql`
        SELECT technician_id::text, TO_CHAR(date, 'YYYY-MM-DD') AS date, SUM(hours_worked) AS hours
        FROM work_hours
        WHERE organization_id = ${org}
          AND deleted_at IS NULL
          AND date < ${until + '-01'}::date AND date <= ${today}::date
        GROUP BY 1, 2
      `,
      sql`
        SELECT DISTINCT LEFT(month, 4) AS year FROM (
          SELECT COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed, 'YYYY-MM')) AS month
            FROM services WHERE organization_id = ${org} AND deleted_at IS NULL
          UNION SELECT competence_month FROM payroll WHERE organization_id = ${org} AND deleted_at IS NULL
          UNION SELECT TO_CHAR(date, 'YYYY-MM') FROM work_hours WHERE organization_id = ${org} AND deleted_at IS NULL
          UNION SELECT TO_CHAR(date, 'YYYY-MM') FROM schedule WHERE organization_id = ${org} AND deleted_at IS NULL
        ) periods
      `,
      sql`
        SELECT DISTINCT LEFT(competence_month, 4) AS year
        FROM financial_entries
        WHERE organization_id = ${org} AND deleted_at IS NULL
      `,
    ]);
    const rows = results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    const [technicians, production, payroll, expenses, schedules, hours, periods, financialPeriods] = rows;
    const data: ManagementData = {
      year,
      today,
      updatedAt: new Date().toISOString(),
      financeAvailable: true,
      years: [
        ...new Set([
          year,
          Number(today.slice(0, 4)),
          ...periods.map((r) => Number(r.year)),
          ...financialPeriods.map((r) => Number(r.year)),
        ]),
      ]
        .filter((y) => y >= 2000 && y <= 2100)
        .sort((a, b) => b - a),
      technicians: technicians.map((t) => ({ id: String(t.id), name: t.name, qra: t.qra, status: t.status })),
      production: production.map((r) => ({
        month: r.month,
        technicianId: String(r.technician_id),
        serviceType: r.service_type,
        revenue: number(r.revenue),
        count: number(r.count),
      })),
      payroll: payroll.map((r) => ({
        month: r.month,
        technicianId: String(r.technician_id),
        status: r.status,
        net: number(r.net_total),
        advances: number(r.advances_total),
        benefits: number(r.benefits),
      })),
      expenses: expenses.map((r) => ({
        month: r.month,
        category: r.category,
        status: r.status,
        amount: number(r.amount),
        paid: number(r.paid),
      })),
      operations: aggregateOperations(
        schedules.map((r) => ({
          technicianId: String(r.technician_id),
          date: r.date,
          status: r.status,
          notes: r.notes,
          start: r.start,
          end: r.end,
        })),
        hours.map((r) => ({ technicianId: String(r.technician_id), date: r.date, hours: number(r.hours) })),
        today,
        await getOrganizationSettings(org),
      ),
    };
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[dashboard-gerencial] Não foi possível consolidar os dados:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os indicadores. Tente novamente.' }, { status: 500 });
  }
}
