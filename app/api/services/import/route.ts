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
        { error: 'Nenhuma OS válida para importar.' },
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
        { error: 'Importe no máximo 1000 OS por lote.' },
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
    const rejected: Array<{ order_code: string; errors: string[] }> = [];

    // Importing the same file twice would double the revenue: a row identical to an OS already on
    // file (same code, technician, day and value), or repeated inside the batch, is rejected.
    const rowKey = (code: string, technicianId: string, date: string, value: number) => `${code}|${technicianId}|${date}|${value.toFixed(2)}`;
    const codes = Array.from(new Set(incomingRows.map((row) => getText(row.order_code)).filter(Boolean)));
    const existingRows = codes.length
      ? await sql.query(
          `SELECT order_code, technician_id::text AS technician_id, date_performed::text AS date_performed, value::float AS value
           FROM services WHERE organization_id = $1 AND deleted_at IS NULL AND order_code = ANY($2)`,
          [auth.organizationId, codes],
        )
      : [];
    const seen = new Set(existingRows.map((row) => rowKey(String(row.order_code), String(row.technician_id), String(row.date_performed), Number(row.value))));
    const accepted: Array<{
      orderCode: string;
      technicianId: string;
      serviceType: string;
      value: number;
      datePerformed: string;
      timePerformed: string;
      description: string;
    }> = [];

    for (const row of incomingRows) {
      const orderCode = getText(row.order_code);
      const technicianId = getText(row.technician_id);
      const serviceType = getText(row.service_type);
      const value = Number(row.value);
      const datePerformed = getText(row.date_performed);
      const timePerformed = getText(row.time_performed);
      const description = getText(row.description);
      const errors: string[] = [];

      if (!orderCode) errors.push('Código da OS ausente');
      if (!technicianId || !technicianNameById.has(technicianId)) errors.push('Técnico não localizado ou inativo');
      if (!serviceType) errors.push('Especialidade ausente');
      if (!Number.isFinite(value) || value <= 0 || value > 99_999_999) errors.push('Valor inválido');
      if (!isDateKey(datePerformed)) errors.push('Data de atendimento inválida');
      if (!isTimeKey(timePerformed)) errors.push('Hora de atendimento inválida');
      if (!isMonthKey(competenceMonth)) errors.push('Competência inválida');

      if (!errors.length) {
        const key = rowKey(orderCode, technicianId, datePerformed, value);
        if (seen.has(key)) errors.push('OS já cadastrada (mesmo código, técnico, data e valor) ou repetida no arquivo');
        else seen.add(key);
      }

      if (errors.length) {
        rejected.push({ order_code: orderCode, errors });
        continue;
      }

      accepted.push({ orderCode, technicianId, serviceType, value, datePerformed, timePerformed, description });
    }

    // One statement for the whole batch: it is all saved or nothing is, so a failure halfway can't
    // leave a partial import that a retry would then duplicate.
    const inserted = accepted.length
      ? await sql.query(
          `INSERT INTO services (
             organization_id, order_code, technician_id, service_type, value,
             date_performed, time_performed, competence_month, fortnight_period, description
           )
           SELECT $1::uuid, r.order_code, r.technician_id, r.service_type, r.value,
                  r.date_performed, r.time_performed, $9::text, $10::text, r.description
           FROM unnest($2::text[], $3::uuid[], $4::text[], $5::numeric[], $6::date[], $7::time[], $8::text[])
             AS r(order_code, technician_id, service_type, value, date_performed, time_performed, description)
           RETURNING id, order_code, technician_id, service_type, value,
                     date_performed, time_performed, competence_month, fortnight_period, description, created_at`,
          [
            auth.organizationId,
            accepted.map((row) => row.orderCode),
            accepted.map((row) => row.technicianId),
            accepted.map((row) => row.serviceType),
            accepted.map((row) => row.value),
            accepted.map((row) => row.datePerformed),
            accepted.map((row) => row.timePerformed),
            accepted.map((row) => row.description || null),
            competenceMonth,
            fortnightPeriod,
          ],
        )
      : [];
    const imported = inserted.map((row) => ({
      ...row,
      technician_name: technicianNameById.get(String(row.technician_id)) ?? '',
    }));

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
