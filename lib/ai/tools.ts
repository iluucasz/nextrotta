import { hasFeature, type Entitlements } from '../billing/entitlements';
import { sql } from '../db';
import { PORTO_WARNING_MARKER } from '../organization-settings';
import { getOrganizationSettings } from '../organization-settings-store';
import type { ToolDefinition } from './deepseek';

/**
 * What the assistant can look up. Every query is read-only and filtered by the organization (and
 * by deleted_at): the model never writes SQL and never sees another organization's data.
 */

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Args = Record<string, unknown>;
type Context = { organizationId: string; entitlements: Entitlements };

function month(value: unknown, label = 'competencia') {
  const text = String(value ?? '');
  if (!MONTH.test(text)) throw new Error(`Parâmetro ${label} deve estar no formato AAAA-MM.`);
  return text;
}

function day(value: unknown, label: string) {
  const text = String(value ?? '');
  if (!DAY.test(text)) throw new Error(`Parâmetro ${label} deve estar no formato AAAA-MM-DD.`);
  return text;
}

const technicianFilter = (value: unknown) => (typeof value === 'string' && value.trim() ? `%${value.trim()}%` : null);

const num = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100);

/** What was settled on a financial entry: all of it when paid, the partial payments otherwise (same rule as the management dashboard). */
function paidOf(row: Record<string, unknown>) {
  const amount = Number(row.amount);
  return row.status === 'paid' ? amount : Math.min(amount, Math.max(0, Number(row.paid_amount ?? 0)));
}

/** The driver returns DATE columns as local-midnight Date objects. */
function dateKey(value: unknown) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value ?? '').slice(0, 10);
}

function monthRange(competence: string) {
  const [year, monthNumber] = competence.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${competence}-01`, to: `${competence}-${String(last).padStart(2, '0')}` };
}

const definitions: Array<ToolDefinition & { feature?: string; run: (args: Args, context: Context) => Promise<unknown> }> = [
  {
    type: 'function',
    function: {
      name: 'resumo_da_empresa',
      description:
        'Regras da empresa (comissão padrão, salário base, VA, VR, jornada mensal, hora extra, intervalo, prêmio por produção), quantidade de técnicos e as competências que têm dados. Use primeiro quando não souber qual mês consultar.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_args, { organizationId }) => {
      const [settings, technicians, competences] = await Promise.all([
        getOrganizationSettings(organizationId),
        sql`SELECT status, COUNT(*)::int AS total FROM technicians WHERE organization_id = ${organizationId} AND deleted_at IS NULL GROUP BY status`,
        sql`
          SELECT COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed, 'YYYY-MM')) AS competencia,
                 COUNT(*)::int AS os, SUM(value)::float AS valor
          FROM services WHERE organization_id = ${organizationId} AND deleted_at IS NULL
          GROUP BY 1 ORDER BY 1 DESC LIMIT 12
        `,
      ]);
      return {
        regras: settings,
        tecnicos: Object.fromEntries(technicians.map((row) => [row.status === 'active' ? 'ativos' : 'inativos', row.total])),
        competencias_com_os: competences.map((row) => ({ competencia: row.competencia, os: row.os, valor: num(row.valor) })),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_tecnicos',
      description: 'Técnicos da empresa com situação e valores próprios de comissão, salário base, VA e VR (vazio = usa o padrão da empresa).',
      parameters: { type: 'object', properties: { incluir_inativos: { type: 'boolean' } } },
    },
    run: async (args, { organizationId }) => {
      const rows = await sql`
        SELECT name, qra, status, commission_percentage, base_salary, va_allowance, vr_allowance, created_at::date AS desde
        FROM technicians
        WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND (${Boolean(args.incluir_inativos)} OR status = 'active')
        ORDER BY name
      `;
      return rows.map((row) => ({
        nome: row.name,
        qra: row.qra,
        situacao: row.status === 'active' ? 'ativo' : 'inativo',
        comissao_percentual: num(row.commission_percentage) || null,
        salario_base: num(row.base_salary) || null,
        va: num(row.va_allowance) || null,
        vr: num(row.vr_allowance) || null,
        desde: row.desde,
      }));
    },
  },
  {
    type: 'function',
    function: {
      name: 'producao_por_tecnico',
      description: 'Ordens de serviço (OS) de uma competência agrupadas por técnico: quantidade e valor total. Opcionalmente só a quinzena Q1 ou Q2.',
      parameters: {
        type: 'object',
        properties: { competencia: { type: 'string', description: 'AAAA-MM' }, quinzena: { type: 'string', enum: ['Q1', 'Q2'] } },
        required: ['competencia'],
      },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.competencia);
      const fortnight = args.quinzena === 'Q1' || args.quinzena === 'Q2' ? args.quinzena : null;
      const [byTechnician, byType] = await Promise.all([
        sql`
          SELECT COALESCE(t.name, 'Sem técnico') AS tecnico, COUNT(*)::int AS os, SUM(s.value)::float AS valor
          FROM services s LEFT JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
            AND COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed, 'YYYY-MM')) = ${competence}
            AND (${fortnight}::text IS NULL OR s.fortnight_period = ${fortnight})
          GROUP BY t.name ORDER BY valor DESC
        `,
        sql`
          SELECT COALESCE(s.service_type, 'Sem tipo') AS tipo, COUNT(*)::int AS os, SUM(s.value)::float AS valor
          FROM services s
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
            AND COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed, 'YYYY-MM')) = ${competence}
            AND (${fortnight}::text IS NULL OR s.fortnight_period = ${fortnight})
          GROUP BY s.service_type ORDER BY valor DESC LIMIT 15
        `,
      ]);
      return {
        competencia: competence,
        quinzena: fortnight ?? 'mês inteiro',
        total_os: byTechnician.reduce((sum, row) => sum + row.os, 0),
        valor_total: num(byTechnician.reduce((sum, row) => sum + Number(row.valor), 0)),
        por_tecnico: byTechnician.map((row) => ({ tecnico: row.tecnico, os: row.os, valor: num(row.valor) })),
        por_tipo_de_servico: byType.map((row) => ({ tipo: row.tipo, os: row.os, valor: num(row.valor) })),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_os',
      description: 'Lista as ordens de serviço de uma competência (até 150), opcionalmente de um técnico (busca por parte do nome).',
      parameters: {
        type: 'object',
        properties: { competencia: { type: 'string', description: 'AAAA-MM' }, tecnico: { type: 'string' } },
        required: ['competencia'],
      },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.competencia);
      const technician = technicianFilter(args.tecnico);
      const [rows, total] = await Promise.all([
        sql`
          SELECT s.date_performed AS data, s.order_code AS os, s.service_type AS tipo, s.value AS valor, s.fortnight_period AS quinzena,
                 t.name AS tecnico
          FROM services s LEFT JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
            AND COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed, 'YYYY-MM')) = ${competence}
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
          ORDER BY s.date_performed, s.order_code
          LIMIT 150
        `,
        sql`
          SELECT COUNT(*)::int AS total
          FROM services s LEFT JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL
            AND COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed, 'YYYY-MM')) = ${competence}
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
        `,
      ]);
      const count = Number(total[0].total);
      return {
        competencia: competence,
        total_os: count,
        exibidas: rows.length,
        aviso: count > rows.length ? 'Só as primeiras OS foram listadas; para totais use producao_por_tecnico ou filtre por técnico.' : undefined,
        os: rows.map((row) => ({ ...row, valor: num(row.valor) })),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'folha_da_competencia',
      description:
        'Folha de pagamento de uma competência por técnico: valor das OS, comissão, salário base, VA, VR, descontos, adiantamentos, horas extras, prêmio, saldo do banco de horas, líquido e se está fechada.',
      parameters: { type: 'object', properties: { competencia: { type: 'string', description: 'AAAA-MM' } }, required: ['competencia'] },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.competencia);
      const rows = await sql`
        SELECT t.name, p.*
        FROM payroll p JOIN technicians t ON t.id = p.technician_id
        WHERE p.organization_id = ${organizationId} AND p.deleted_at IS NULL AND p.competence_month = ${competence}
        ORDER BY t.name
      `;
      if (!rows.length) return { competencia: competence, aviso: 'Nenhuma folha calculada nesta competência.' };
      return {
        competencia: competence,
        total_liquido: num(rows.reduce((sum, row) => sum + Number(row.net_total), 0)),
        por_tecnico: rows.map((row) => ({
          tecnico: row.name,
          situacao: row.status === 'closed' ? 'fechada' : 'rascunho',
          valor_os: num(row.total_services_value),
          comissao: num(row.commission_value),
          salario_base: num(row.base_salary),
          va: num(row.va_deduction),
          vr: num(row.vr_deduction),
          descontos: num(row.discounts_total),
          adiantamentos: num(row.advances_total),
          horas_extras: num(row.extra_hours_value),
          premio: num(row.extraordinary_award_value),
          saldo_banco_de_horas: num(row.hour_bank_balance),
          liquido: num(row.net_total),
        })),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'horas_trabalhadas',
      description:
        'Horas apontadas num mês por técnico: dias trabalhados, total de horas, média por dia, diferença para a jornada mensal, dias importados do Porto, folgas/faltas/justificados/serviços cancelados e as advertências por laudo não preenchido (com as datas).',
      parameters: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM' }, tecnico: { type: 'string' } }, required: ['mes'] },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.mes, 'mes');
      const { from, to } = monthRange(competence);
      const technician = technicianFilter(args.tecnico);
      const [rows, notes, settings] = await Promise.all([
        sql`
          SELECT t.name, COUNT(DISTINCT w.date)::int AS dias, SUM(w.hours_worked)::float AS horas,
                 COUNT(DISTINCT w.date) FILTER (WHERE w.source = 'porto')::int AS dias_importados_do_porto
          FROM work_hours w JOIN technicians t ON t.id = w.technician_id
          WHERE w.organization_id = ${organizationId} AND w.deleted_at IS NULL AND w.date BETWEEN ${from}::date AND ${to}::date
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
          GROUP BY t.name ORDER BY t.name
        `,
        // The day's situation and the laudo warning live in the schedule row's note.
        sql`
          SELECT t.name, s.date, s.notes
          FROM schedule s JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL AND s.date BETWEEN ${from}::date AND ${to}::date
            AND (s.notes LIKE 'Apontamento manual:%' OR s.notes LIKE ${`%${PORTO_WARNING_MARKER}%`})
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
        `,
        getOrganizationSettings(organizationId),
      ]);

      const situations = new Map<string, Record<string, number>>();
      const warnings = new Map<string, string[]>();
      for (const row of notes) {
        const name = String(row.name);
        const text = String(row.notes ?? '');
        const label = text.match(/^Apontamento manual: ([^;]+)/)?.[1]?.trim();
        if (label && label !== 'trabalhou') {
          const counts = situations.get(name) ?? {};
          counts[label] = (counts[label] ?? 0) + 1;
          situations.set(name, counts);
        }
        if (text.includes(PORTO_WARNING_MARKER)) {
          const list = warnings.get(name) ?? [];
          list.push(dateKey(row.date));
          warnings.set(name, list);
        }
      }
      const names = new Set([...rows.map((row) => String(row.name)), ...situations.keys(), ...warnings.keys()]);
      const byName = new Map(rows.map((row) => [String(row.name), row]));

      return {
        mes: competence,
        jornada_mensal: settings.monthlyHours,
        por_tecnico: [...names].sort().map((name) => {
          const row = byName.get(name);
          const hours = row ? Number(row.horas) : 0;
          const days = row ? Number(row.dias) : 0;
          return {
            tecnico: name,
            dias_trabalhados: days,
            horas: num(hours),
            media_por_dia: days ? num(hours / days) : null,
            diferenca_para_jornada: num(hours - settings.monthlyHours),
            dias_importados_do_porto: row ? Number(row.dias_importados_do_porto) : 0,
            situacoes: situations.get(name) ?? {},
            advertencias: (warnings.get(name) ?? []).sort(),
          };
        }),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'escala',
      description: 'Escala da equipe num período (até 62 dias): turnos por técnico e totais por situação (agendado, concluído, cancelado).',
      parameters: {
        type: 'object',
        properties: { data_inicio: { type: 'string', description: 'AAAA-MM-DD' }, data_fim: { type: 'string', description: 'AAAA-MM-DD' }, tecnico: { type: 'string' } },
        required: ['data_inicio', 'data_fim'],
      },
    },
    run: async (args, { organizationId }) => {
      const from = day(args.data_inicio, 'data_inicio');
      const to = day(args.data_fim, 'data_fim');
      if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) throw new Error('Período máximo de 62 dias.');
      const technician = technicianFilter(args.tecnico);
      const [rows, counts] = await Promise.all([
        sql`
          SELECT s.date AS data, s.start_time AS inicio, s.end_time AS fim, s.status::text AS situacao, s.notes AS observacao, t.name AS tecnico
          FROM schedule s JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL AND s.date BETWEEN ${from}::date AND ${to}::date
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
          ORDER BY s.date, t.name
          LIMIT 300
        `,
        // Totals come from the database, not from the (capped) list above.
        sql`
          SELECT s.status::text AS situacao, COUNT(*)::int AS total
          FROM schedule s JOIN technicians t ON t.id = s.technician_id
          WHERE s.organization_id = ${organizationId} AND s.deleted_at IS NULL AND s.date BETWEEN ${from}::date AND ${to}::date
            AND (${technician}::text IS NULL OR t.name ILIKE ${technician})
          GROUP BY s.status
        `,
      ]);
      const totals: Record<string, number> = {};
      for (const row of counts) totals[row.situacao] = Number(row.total);
      const count = Object.values(totals).reduce((sum, value) => sum + value, 0);
      return {
        periodo: { de: from, ate: to },
        total_turnos: count,
        totais_por_situacao: totals,
        aviso: count > rows.length ? `Só os primeiros ${rows.length} turnos foram listados; os totais acima são do período todo. Reduza o período ou filtre por técnico.` : undefined,
        turnos: rows,
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'descontos_e_adiantamentos',
      description: 'Descontos, adiantamentos e outros lançamentos da folha de uma competência, por técnico.',
      parameters: { type: 'object', properties: { competencia: { type: 'string', description: 'AAAA-MM' } }, required: ['competencia'] },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.competencia);
      const rows = await sql`
        SELECT t.name AS tecnico, d.type AS tipo, d.amount AS valor, d.reason AS motivo
        FROM discounts d JOIN technicians t ON t.id = d.technician_id
        WHERE d.organization_id = ${organizationId} AND d.deleted_at IS NULL AND d.competence_month = ${competence}
        ORDER BY t.name
      `;
      const labels: Record<string, string> = { discount: 'desconto', advance: 'adiantamento', other: 'outro' };
      return rows.map((row) => ({ ...row, tipo: labels[row.tipo] ?? row.tipo, valor: num(row.valor) }));
    },
  },
  {
    type: 'function',
    feature: 'finance',
    function: {
      name: 'financeiro_do_mes',
      description: 'Contas a pagar e a receber com vencimento no mês: totais pagos e pendentes, por categoria, e os maiores lançamentos.',
      parameters: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM' } }, required: ['mes'] },
    },
    run: async (args, { organizationId }) => {
      const competence = month(args.mes, 'mes');
      const { from, to } = monthRange(competence);
      const rows = await sql`
        SELECT type, status, COALESCE(category, 'Sem categoria') AS category, description, amount, paid_amount, due_date
        FROM financial_entries
        WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND due_date BETWEEN ${from}::date AND ${to}::date
      `;
      const summary: Record<string, { pago: number; pendente: number; por_categoria: Record<string, number> }> = {
        a_pagar: { pago: 0, pendente: 0, por_categoria: {} },
        a_receber: { pago: 0, pendente: 0, por_categoria: {} },
      };
      for (const row of rows) {
        const bucket = summary[row.type === 'payable' ? 'a_pagar' : 'a_receber'];
        const amount = Number(row.amount);
        const paid = paidOf(row);
        bucket.pago += paid;
        bucket.pendente += amount - paid;
        bucket.por_categoria[row.category] = num((bucket.por_categoria[row.category] ?? 0) + amount)!;
      }
      const largest = [...rows]
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 15)
        .map((row) => {
          const paid = paidOf(row);
          return {
            tipo: row.type === 'payable' ? 'a pagar' : 'a receber',
            descricao: row.description,
            categoria: row.category,
            valor: num(row.amount),
            vencimento: row.due_date,
            situacao: row.status === 'paid' ? 'pago' : paid > 0 ? 'parcialmente pago' : 'pendente',
            valor_pago: num(paid),
          };
        });
      for (const bucket of Object.values(summary)) {
        bucket.pago = num(bucket.pago)!;
        bucket.pendente = num(bucket.pendente)!;
      }
      return { mes: competence, ...summary, maiores_lancamentos: largest };
    },
  },
  {
    type: 'function',
    feature: 'porto',
    function: {
      name: 'robo_do_porto',
      description:
        'Situação da integração com o Portal do Prestador (Porto Seguro): se a automação está ligada ou em modo teste e as últimas execuções do robô (importação de horas e de escala) com resultado, linhas gravadas, avisos e possível mudança de tela do portal.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_args, { organizationId }) => {
      const [config, runs] = await Promise.all([
        sql`SELECT automation_enabled, dry_run_only FROM porto_config WHERE organization_id = ${organizationId}`,
        sql`
          SELECT job_type, run_trigger, status, started_at, finished_at, technicians_processed, rows_written,
                 error_message, layout_suspect, range_start, range_end
          FROM porto_sync_log
          WHERE organization_id = ${organizationId}
          ORDER BY started_at DESC LIMIT 12
        `,
      ]);
      const time = (value: unknown) =>
        value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value as string)) : null;
      return {
        configurado: Boolean(config[0]),
        automacao_ligada: Boolean(config[0]?.automation_enabled),
        modo_teste: config[0]?.dry_run_only !== false,
        ultimas_execucoes: runs.map((row) => ({
          tipo: row.job_type === 'hours' ? 'horas' : 'escala',
          disparo: row.run_trigger === 'manual' ? 'manual' : 'automático',
          resultado: row.status,
          inicio: time(row.started_at),
          fim: time(row.finished_at),
          periodo: row.range_start ? `${dateKey(row.range_start)} a ${dateKey(row.range_end)}` : null,
          tecnicos: row.technicians_processed,
          linhas_gravadas: row.rows_written,
          avisos_ou_erro: row.error_message,
          possivel_mudanca_de_tela_no_porto: Boolean(row.layout_suspect),
        })),
      };
    },
  },
];

/** The tools this organization's plan allows (e.g. finance only with the finance feature). */
export function availableTools(entitlements: Entitlements): ToolDefinition[] {
  return definitions
    .filter((tool) => !tool.feature || hasFeature(entitlements, tool.feature))
    .map(({ type, function: fn }) => ({ type, function: fn }));
}

/** Runs one tool call; errors go back to the model as text so it can correct itself. */
export async function runTool(name: string, rawArguments: string, context: Context): Promise<string> {
  const tool = definitions.find((item) => item.function.name === name);
  if (!tool || (tool.feature && !hasFeature(context.entitlements, tool.feature))) return JSON.stringify({ erro: `Consulta "${name}" indisponível.` });
  let args: Args = {};
  try {
    args = rawArguments ? (JSON.parse(rawArguments) as Args) : {};
  } catch {
    return JSON.stringify({ erro: 'Argumentos inválidos (JSON).' });
  }
  try {
    const result = await tool.run(args, context);
    const text = JSON.stringify(result);
    // Keep each result small enough for the context window.
    return text.length > 24_000 ? `${text.slice(0, 24_000)}… (resultado cortado; peça um filtro mais específico)` : text;
  } catch (error) {
    return JSON.stringify({ erro: error instanceof Error ? error.message : 'Falha na consulta.' });
  }
}
