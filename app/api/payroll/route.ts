import { sql } from '@/lib/db';
import { after, NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { notifyPayrollClosed } from '@/lib/whatsapp/notifications';

const payrollNumericFields = [
  'total_services_value',
  'commission_value',
  'base_salary',
  'va_deduction',
  'vr_deduction',
  'discounts_total',
  'advances_total',
  'extra_hours_value',
  'extraordinary_award_value',
  'hour_bank_balance',
  'net_total',
] as const;

function roundCurrency(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

function normalizePayrollRow<T extends Record<string, unknown>>(row: T) {
  return payrollNumericFields.reduce(
    (normalized, field) => ({
      ...normalized,
      [field]: roundCurrency(row[field] as number | string | null | undefined),
    }),
    { ...row },
  );
}

async function isActiveTechnician(organizationId: string, technicianId: string) {
  const technicians = await sql`
    SELECT status
    FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  return technicians[0]?.status === 'active';
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const competenceMonth = searchParams.get('competenceMonth');
    const technicianId = searchParams.get('technicianId');

    let query = `
      SELECT p.*
      FROM payroll p
      INNER JOIN technicians t ON t.id = p.technician_id
    `;

    const params: string[] = [auth.organizationId];
    const conditions = [
      'p.organization_id = $1',
      'p.deleted_at IS NULL',
      `t.status = 'active'`,
      't.deleted_at IS NULL',
    ];

    // A technician only ever sees their own payroll, whatever technicianId the request names.
    if (auth.role === 'technician') {
      conditions.push(`p.technician_id = $${params.length + 1}`);
      params.push(auth.technicianId || auth.userId);
    } else if (technicianId) {
      conditions.push(`p.technician_id = $${params.length + 1}`);
      params.push(technicianId);
    }

    // O técnico só enxerga folhas efetivamente fechadas. Rascunhos ficam
    // restritos ao admin até o fechamento explícito.
    if (auth.role === 'technician') {
      conditions.push(`p.status = 'closed'`);
    }

    if (competenceMonth) {
      conditions.push(`p.competence_month = $${params.length + 1}`);
      params.push(competenceMonth);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;

    query += ` ORDER BY p.competence_month DESC`;

    const payrolls = await sql.query(query, params);
    return NextResponse.json({ payrolls: payrolls.map((row) => normalizePayrollRow(row as Record<string, unknown>)) });
  } catch (error) {
    console.error('[v0] Get payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      technician_id,
      competence_month,
      total_services_value,
      commission_value,
      base_salary,
      va_deduction,
      vr_deduction,
      discounts_total,
      advances_total,
      extra_hours_value,
      extraordinary_award_value = 0,
      hour_bank_balance,
      net_total,
      status,
    } = await request.json();

    if (!(await isActiveTechnician(auth.organizationId, technician_id))) {
      return NextResponse.json(
        { error: 'Selecione um tecnico ativo para fechar folha.' },
        { status: 409 }
      );
    }

    const payrollStatus = status === 'closed' ? 'closed' : 'draft';

    const values = {
      total_services_value: roundCurrency(total_services_value),
      commission_value: roundCurrency(commission_value),
      base_salary: roundCurrency(base_salary),
      va_deduction: roundCurrency(va_deduction),
      vr_deduction: roundCurrency(vr_deduction),
      discounts_total: roundCurrency(discounts_total),
      advances_total: roundCurrency(advances_total),
      extra_hours_value: roundCurrency(extra_hours_value),
      extraordinary_award_value: roundCurrency(extraordinary_award_value),
      hour_bank_balance: roundCurrency(hour_bank_balance),
      net_total: roundCurrency(net_total),
    };

    const result = await sql`
      INSERT INTO payroll (
        organization_id, technician_id, competence_month, total_services_value, commission_value,
        base_salary, va_deduction, vr_deduction, discounts_total,
        advances_total, extra_hours_value, extraordinary_award_value, hour_bank_balance, net_total, status
      )
      VALUES (
        ${auth.organizationId}, ${technician_id}, ${competence_month}, ${values.total_services_value}, ${values.commission_value},
        ${values.base_salary}, ${values.va_deduction}, ${values.vr_deduction}, ${values.discounts_total},
        ${values.advances_total}, ${values.extra_hours_value}, ${values.extraordinary_award_value}, ${values.hour_bank_balance}, ${values.net_total}, ${payrollStatus}
      )
      ON CONFLICT (technician_id, competence_month) DO UPDATE
      SET total_services_value = EXCLUDED.total_services_value,
          commission_value = EXCLUDED.commission_value,
          base_salary = EXCLUDED.base_salary,
          va_deduction = EXCLUDED.va_deduction,
          vr_deduction = EXCLUDED.vr_deduction,
          discounts_total = EXCLUDED.discounts_total,
          advances_total = EXCLUDED.advances_total,
          extra_hours_value = EXCLUDED.extra_hours_value,
          extraordinary_award_value = EXCLUDED.extraordinary_award_value,
          hour_bank_balance = EXCLUDED.hour_bank_balance,
          net_total = EXCLUDED.net_total,
          status = EXCLUDED.status,
          deleted_at = NULL,
          deleted_by = NULL,
          updated_at = NOW()
      RETURNING *
    `;

    // After the response, so a slow or offline WhatsApp never holds up closing the payroll. Every
    // save of a closed payroll lands here; the notification's dedupe key keeps it to one message.
    if (payrollStatus === 'closed') {
      after(async () => {
        try {
          await notifyPayrollClosed(auth.organizationId, { technicianId: String(technician_id), competenceMonth: String(competence_month), netTotal: values.net_total });
        } catch (error) {
          console.error('[payroll] WhatsApp notification failed:', error);
        }
      });
    }

    return NextResponse.json(normalizePayrollRow(result[0] as Record<string, unknown>), { status: 201 });
  } catch (error) {
    console.error('[v0] Create/update payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
