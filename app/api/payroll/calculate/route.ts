import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { calculatePayroll } from '@/lib/payroll-utils';
import { sql } from '@/lib/db';

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

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { technicianId, competenceMonth } = await request.json();

    if (!technicianId || !competenceMonth) {
      return NextResponse.json(
        { error: 'technicianId and competenceMonth are required' },
        { status: 400 }
      );
    }

    if (!(await isActiveTechnician(auth.organizationId, technicianId))) {
      return NextResponse.json(
        { error: 'Selecione um tecnico ativo para fechar folha.' },
        { status: 409 }
      );
    }

    // Calculate payroll
    const payrollData = await calculatePayroll({
      organizationId: auth.organizationId,
      technicianId,
      competenceMonth,
    });

    // Save or update payroll
    const result = await sql`
      INSERT INTO payroll (
        organization_id, technician_id, competence_month, total_services_value, commission_value,
        base_salary, va_deduction, vr_deduction, discounts_total,
        advances_total, extra_hours_value, extraordinary_award_value, hour_bank_balance, net_total
      )
      VALUES (
        ${auth.organizationId}, ${payrollData.technician_id}, ${payrollData.competence_month},
        ${payrollData.total_services_value}, ${payrollData.commission_value},
        ${payrollData.base_salary}, ${payrollData.va_deduction},
        ${payrollData.vr_deduction}, ${payrollData.discounts_total},
        ${payrollData.advances_total}, ${payrollData.extra_hours_value},
        ${payrollData.extraordinary_award_value}, ${payrollData.hour_bank_balance}, ${payrollData.net_total}
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
          deleted_at = NULL,
          deleted_by = NULL,
          updated_at = NOW()
      RETURNING *
    `;

    return NextResponse.json(
      {
        success: true,
        payroll: result[0],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Calculate payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
