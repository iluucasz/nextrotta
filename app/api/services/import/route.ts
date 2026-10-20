import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

interface ServiceImportPayload {
  order_code?: unknown;
  technician_id?: unknown;
  technician_name?: unknown;
  service_type?: unknown;
  value?: unknown;
  date_performed?: unknown;
  time_performed?: unknown;
  competence_month?: unknown;
  description?: unknown;
}

function isFortnightPeriod(value: string) {
  return value === 'Q1' || value === 'Q2';
}

function getText(value: unknown) {
  return String(value ?? '').trim();
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMonthKey(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function isTimeKey(value: string) {
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(value);
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

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'service_import');
    if (featureBlocked) return featureBlocked;

    const body = await request.json();
    const incomingRows = Array.isArray(body?.services) ? (body.services as ServiceImportPayload[]) : [];
    const fortnightPeriod = getText(body?.fortnight_period).toUpperCase();
    const competenceMonth = getText(body?.competence_month);

    if (!incomingRows.length) {
      return NextResponse.json(
        { error: 'Nenhuma OS valida para importar.' },
        { status: 400 }
      );
    }

    if (!isFortnightPeriod(fortnightPeriod)) {
      return NextResponse.json(
        { error: 'Selecione Q1 ou Q2 para importar este lote.' },
        { status: 400 }
      );
    }

    if (!isMonthKey(competenceMonth)) {
      return NextResponse.json(
        { error: 'Defina uma competência válida para importar este lote.' },
        { status: 400 }
      );
    }

    if (incomingRows.length > 1000) {
      return NextResponse.json(
        { error: 'Importe no maximo 1000 OS por lote.' },
        { status: 413 }
      );
    }

    const technicianIds = Array.from(new Set(incomingRows.map((row) => getText(row.technician_id)).filter(Boolean)));
    const technicianRows = technicianIds.length
      ? await sql.query(
          `SELECT id, name FROM technicians
           WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL AND id = ANY($2)`,
          [auth.organizationId, technicianIds],
        )
      : [];
    const technicianNameById = new Map(technicianRows.map((row) => [String(row.id), String(row.name)]));
    const imported: Record<string, unknown>[] = [];
    const rejected: Array<{ order_code: string; errors: string[] }> = [];

    for (const row of incomingRows) {
      const orderCode = getText(row.order_code);
      const technicianId = getText(row.technician_id);
      const serviceType = getText(row.service_type);
      const value = Number(row.value);
      const datePerformed = getText(row.date_performed);
      const timePerformed = getText(row.time_performed);
      const description = getText(row.description);
      const errors: string[] = [];

      if (!orderCode) errors.push('Codigo da OS ausente');
      if (!technicianId || !technicianNameById.has(technicianId)) errors.push('Tecnico nao localizado ou inativo');
      if (!serviceType) errors.push('Especialidade ausente');
      if (!Number.isFinite(value) || value <= 0) errors.push('Valor invalido');
      if (!isDateKey(datePerformed)) errors.push('Data de atendimento invalida');
      if (!isTimeKey(timePerformed)) errors.push('Hora de atendimento invalida');
      if (!isMonthKey(competenceMonth)) errors.push('Competencia invalida');

      if (errors.length) {
        rejected.push({ order_code: orderCode, errors });
        continue;
      }

      const result = await sql`
        INSERT INTO services (
          organization_id, order_code, technician_id, service_type, value,
          date_performed, time_performed, competence_month, fortnight_period, description
        )
        VALUES (
          ${auth.organizationId}, ${orderCode}, ${technicianId}, ${serviceType}, ${value},
          ${datePerformed}, ${timePerformed}, ${competenceMonth}, ${fortnightPeriod}, ${description || null}
        )
        RETURNING id, order_code, technician_id, service_type, value,
                  date_performed, time_performed, competence_month, fortnight_period, description, created_at
      `;

      imported.push({
        ...result[0],
        technician_name: technicianNameById.get(technicianId) || getText(row.technician_name),
      });
    }

    return NextResponse.json({
      services: imported,
      imported: imported.length,
      rejected,
    });
  } catch (error) {
    console.error('[v0] Import services error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
