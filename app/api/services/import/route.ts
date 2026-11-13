import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { getOrganizationSettings } from '@/lib/organization-settings-store';
import { fortnightForDay } from '@/lib/organization-settings';
import { competenceForImportRow, isDateKey, isMonthKey, monthLabel } from '@/lib/pay-calendar';

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
    const settings = await getOrganizationSettings(auth.organizationId);
    // By the service's own date each OS goes to its own month (and its fortnight follows its day);
    // by batch the whole file goes to the month and fortnight the admin chose.
    const byServiceDate = settings.competenceSource === 'service_date';
    const fortnightPeriod = getText(body?.fortnight_period).toUpperCase();
    const competenceMonth = getText(body?.competence_month);
    const allowClosedPayroll = body?.allow_closed_payroll === true;

    if (!incomingRows.length) {
      return NextResponse.json(
        { error: 'Nenhuma OS válida para importar.' },
        { status: 400 }
      );
    }

    if (!byServiceDate && !isFortnightPeriod(fortnightPeriod)) {
      return NextResponse.json(
        { error: 'Selecione Q1 ou Q2 para importar este lote.' },
        { status: 400 }
      );
    }

    if (!byServiceDate && !isMonthKey(competenceMonth)) {
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
      competenceMonth: string;
      fortnightPeriod: string;
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
      // The month is always worked out here: what the screen shows is only a preview.
      const rowCompetence = competenceForImportRow(settings.competenceSource, datePerformed, competenceMonth);
      if (!isMonthKey(rowCompetence)) errors.push('Competência inválida');

      if (!errors.length) {
        const key = rowKey(orderCode, technicianId, datePerformed, value);
        if (seen.has(key)) errors.push('OS já cadastrada (mesmo código, técnico, data e valor) ou repetida no arquivo');
        else seen.add(key);
      }

      if (errors.length) {
        rejected.push({ order_code: orderCode, errors });
        continue;
      }

      accepted.push({
        orderCode,
        technicianId,
        serviceType,
        value,
        datePerformed,
        timePerformed,
        description,
        competenceMonth: rowCompetence,
        fortnightPeriod: byServiceDate ? fortnightForDay(Number(datePerformed.slice(8, 10)), settings.fortnightSplitDay) : fortnightPeriod,
      });
    }

    // A closed folha keeps the values it was closed with, so an OS of that month would be on the list
    // but never paid. By the service's date the admin is warned and has to confirm the import.
    if (byServiceDate && !allowClosedPayroll && accepted.length) {
      const closedRows = await sql.query(
        `SELECT technician_id::text AS technician_id, competence_month FROM payroll
         WHERE organization_id = $1 AND status = 'closed' AND deleted_at IS NULL
           AND technician_id = ANY($2::uuid[]) AND competence_month = ANY($3::text[])`,
        [auth.organizationId, accepted.map((row) => row.technicianId), accepted.map((row) => row.competenceMonth)],
      );
      const closedKeys = new Set(closedRows.map((row) => `${row.technician_id}|${row.competence_month}`));
      for (let index = accepted.length - 1; index >= 0; index -= 1) {
        const row = accepted[index];
        if (!closedKeys.has(`${row.technicianId}|${row.competenceMonth}`)) continue;
        rejected.push({ order_code: row.orderCode, errors: [`A folha de ${monthLabel(row.competenceMonth)} deste técnico já está fechada`] });
        accepted.splice(index, 1);
      }
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
                  r.date_performed, r.time_performed, r.competence_month, r.fortnight_period, r.description
           FROM unnest($2::text[], $3::uuid[], $4::text[], $5::numeric[], $6::date[], $7::time[], $8::text[], $9::text[], $10::text[])
             AS r(order_code, technician_id, service_type, value, date_performed, time_performed, description, competence_month, fortnight_period)
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
            accepted.map((row) => row.competenceMonth),
            accepted.map((row) => row.fortnightPeriod),
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
