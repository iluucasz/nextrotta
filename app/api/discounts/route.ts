import { sql } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';

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
    const technicianId = searchParams.get('technicianId');
    const competenceMonth = searchParams.get('competenceMonth');

    let query = `
      SELECT id, technician_id, type, amount, reason, competence_month, created_at
      FROM discounts
    `;

    const params: string[] = [auth.organizationId];
    const conditions = [
      'organization_id = $1',
      'deleted_at IS NULL',
      `EXISTS (SELECT 1 FROM technicians t WHERE t.id = discounts.technician_id AND t.status = 'active' AND t.deleted_at IS NULL)`,
    ];

    if (auth.role === 'technician') {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(auth.technicianId || auth.userId);
    } else if (technicianId) {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(technicianId);
    }

    if (competenceMonth) {
      conditions.push(`competence_month = $${params.length + 1}`);
      params.push(competenceMonth);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;

    query += ` ORDER BY created_at DESC`;

    const discounts = await sql.query(query, params);
    return NextResponse.json({ discounts });
  } catch (error) {
    console.error('[v0] Get discounts error:', error);
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
      type,
      amount,
      reason,
      competence_month,
    } = await request.json();

    if (!(await isActiveTechnician(auth.organizationId, technician_id))) {
      return NextResponse.json(
        { error: 'Selecione um tecnico ativo para lancar descontos ou adiantamentos.' },
        { status: 409 }
      );
    }

    const result = await sql`
      INSERT INTO discounts (
        organization_id, technician_id, type, amount, reason, competence_month
      )
      VALUES (
        ${auth.organizationId}, ${technician_id}, ${type}, ${amount}, ${reason}, ${competence_month}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create discount error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
