import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
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

function inactiveTechnicianResponse() {
  return NextResponse.json(
    { error: 'Selecione um tecnico ativo para lancar OS.' },
    { status: 409 }
  );
}

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function isFortnightPeriod(value: string) {
  return value === 'Q1' || value === 'Q2';
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
      SELECT s.id, s.order_code, s.technician_id, s.service_type, s.value,
             s.date_performed, s.time_performed, s.competence_month, s.fortnight_period, s.description, s.created_at,
             t.name AS technician_name
      FROM services s
      LEFT JOIN technicians t ON t.id = s.technician_id
    `;

    const scopedTechnicianId = auth.role === 'technician' ? auth.technicianId || auth.userId : technicianId;
    const params: string[] = [auth.organizationId];
    const conditions: string[] = ['s.organization_id = $1', 's.deleted_at IS NULL'];

    if (scopedTechnicianId) {
      params.push(scopedTechnicianId);
      conditions.push(`s.technician_id = $${params.length}`);
    }

    conditions.push(`t.status = 'active'`, 't.deleted_at IS NULL');

    if (competenceMonth) {
      params.push(competenceMonth);
      conditions.push(`COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed::date, 'YYYY-MM')) = $${params.length}`);
    }

    if (auth.role === 'admin' || scopedTechnicianId) {
      if (conditions.length) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY s.date_performed DESC, s.time_performed DESC NULLS LAST, s.created_at DESC`;
      const services = await sql.query(query, params);
      return NextResponse.json({ services });
    }

    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  } catch (error) {
    console.error('[v0] Get services error:', error);
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
      order_code,
      technician_id,
      service_type,
      value,
      date_performed,
      time_performed,
      competence_month,
      fortnight_period,
      description,
    } = await request.json();

    if (!(await isActiveTechnician(auth.organizationId, technician_id))) {
      return inactiveTechnicianResponse();
    }

    const result = await sql`
      INSERT INTO services (
        organization_id, order_code, technician_id, service_type, value,
        date_performed, time_performed, competence_month, fortnight_period, description
      )
      VALUES (
        ${auth.organizationId}, ${order_code}, ${technician_id}, ${service_type}, ${value},
        ${date_performed}, ${time_performed || null}, ${competence_month || String(date_performed ?? '').slice(0, 7)}, ${fortnight_period || null}, ${description}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      id,
      order_code,
      technician_id,
      service_type,
      value,
      date_performed,
      time_performed,
      competence_month,
      fortnight_period,
      description,
    } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Service id is required' },
        { status: 400 }
      );
    }

    const currentService = await sql`
      SELECT technician_id
      FROM services
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!currentService.length) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    if (!(await isActiveTechnician(auth.organizationId, technician_id))) {
      return inactiveTechnicianResponse();
    }

    const result = await sql`
      UPDATE services
      SET order_code = ${order_code},
          technician_id = ${technician_id},
          service_type = ${service_type},
          value = ${value},
          date_performed = ${date_performed},
          time_performed = ${time_performed || null},
          competence_month = ${competence_month || String(date_performed ?? '').slice(0, 7)},
          fortnight_period = ${fortnight_period || null},
          description = ${description || null},
          updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
      RETURNING *
    `;

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error('[v0] Update service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const mode = searchParams.get('mode');

    if (mode === 'bulk') {
      const competenceMonth = String(searchParams.get('competenceMonth') ?? '').trim();
      const rawPeriod = String(searchParams.get('period') ?? '').trim();
      const normalizedPeriod = rawPeriod.toUpperCase();
      const isMonthly = rawPeriod.toLowerCase() === 'monthly';
      const confirmation = String(searchParams.get('confirmation') ?? '').trim().toUpperCase();

      if (confirmation !== 'DELETAR OS') {
        return NextResponse.json(
          { error: 'Confirme a delecao digitando DELETAR OS.' },
          { status: 400 }
        );
      }

      if (!isMonthKey(competenceMonth)) {
        return NextResponse.json(
          { error: 'Selecione uma competencia valida para deletar as OS.' },
          { status: 400 }
        );
      }

      if (!isMonthly && !isFortnightPeriod(normalizedPeriod)) {
        return NextResponse.json(
          { error: 'Selecione Mensal, Q1 ou Q2 para deletar as OS.' },
          { status: 400 }
        );
      }

      // Archived, not removed: the rows stay restorable from the trash.
      const params = isMonthly
        ? [auth.organizationId, auth.userId, competenceMonth]
        : [auth.organizationId, auth.userId, competenceMonth, normalizedPeriod];
      const periodCondition = isMonthly ? '' : ' AND fortnight_period = $4';
      const result = await sql.query(
        `
          UPDATE services
          SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
          WHERE organization_id = $1
            AND deleted_at IS NULL
            AND COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed::date, 'YYYY-MM')) = $3
          ${periodCondition}
          RETURNING id
        `,
        params
      );

      return NextResponse.json({
        success: true,
        deleted: result.length,
        ids: result.map((service) => service.id),
        competenceMonth,
        period: isMonthly ? 'monthly' : normalizedPeriod,
      });
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Service id is required' },
        { status: 400 }
      );
    }

    const result = await sql`
      UPDATE services
      SET deleted_at = NOW(), deleted_by = ${auth.userId}, updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      RETURNING id
    `;

    if (!result.length) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[v0] Delete service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
