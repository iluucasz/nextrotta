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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { technicianId, competenceMonth } = await request.json();

    if (!technicianId || !competenceMonth) {
      return NextResponse.json({ error: 'technicianId and competenceMonth are required' }, { status: 400 });
    }

    if (!(await isActiveTechnician(auth.organizationId, technicianId))) {
      return NextResponse.json({ error: 'Selecione um tecnico ativo para fechar folha.' }, { status: 409 });
    }

    const payroll = await calculatePayroll({ organizationId: auth.organizationId, technicianId, competenceMonth });

    return NextResponse.json({ payroll });
  } catch (error) {
    console.error('[payroll-preview] Calculate payroll preview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
