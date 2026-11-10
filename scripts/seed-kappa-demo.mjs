// Fills the Kappa Assistência Técnica test organization (kappa.nextrotta.app) with fictional demo data, so it can be
// shown to a prospective customer. Everything is written to the database for that organization only — nothing is mocked
// in the code.
//
//   node scripts/seed-kappa-demo.mjs --dry     runs the whole thing in one transaction and rolls it back
//   node scripts/seed-kappa-demo.mjs           writes for real (then run scripts/seed-kappa-payroll.cjs)
//
// Safety: refuses to run unless the organization with slug "kappa" is flagged as a test organization. The target
// database (the one in .env.local / .env) is printed first. Nothing is deleted: the old schedule is archived (deleted_at).
// Idempotent by checks: a block that finds its data already there is skipped.
import { openPool } from './lib/db.mjs';

const DRY = process.argv.includes('--dry');
const SLUG = 'kappa';
const TODAY = '2026-11-09'; // the day the demo is prepared for ("today" in the demo)

// ------------------------------------------------------------------------------------------------ helpers
let seed = 20261109;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

const toUtc = (key) => new Date(`${key}T12:00:00Z`);
const key = (date) => date.toISOString().slice(0, 10);
const addDays = (k, n) => key(new Date(toUtc(k).getTime() + n * 86400000));
const dow = (k) => toUtc(k).getUTCDay(); // 0 = Sunday
const monthOf = (k) => k.slice(0, 7);
const addMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const days = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** Brasília wall-clock time as a timestamptz literal. */
const at = (dateKey, hh, mm = 0) => `${dateKey}T${pad(hh)}:${pad(mm)}:00-03:00`;
const isoWeek = (k) => {
  const d = toUtc(k);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
};

const { pool, target } = openPool();
console.log(`Banco de destino: ${target}${DRY ? '  (--dry: nada será gravado)' : ''}`);
const client = await pool.connect();
const q = async (text, params) => (await client.query(text, params)).rows;
const log = (message) => console.log(message);

try {
  await client.query('BEGIN');

  // ---------------------------------------------------------------------------------------------- guard
  const org = (await q(`SELECT id, name, slug, is_test, status FROM organizations WHERE slug = $1 AND deleted_at IS NULL`, [SLUG]))[0];
  if (!org) throw new Error('Organização kappa não encontrada.');
  if (!org.is_test) throw new Error('A organização kappa não está marcada como conta de teste — parando.');
  const ORG = org.id;
  log(`Organização: ${org.name} (${org.slug}), conta de teste.`);

  const technicians = await q(
    `SELECT id, name, qra, user_id, base_salary FROM technicians WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY name`,
    [ORG],
  );
  if (technicians.length < 3) throw new Error('Esperava os técnicos de teste da kappa.');
  const admin = (await q(`SELECT id FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY (email LIKE 'carla%') DESC LIMIT 1`, [ORG]))[0];
  const ADMIN_ID = admin.id;
  log(`Técnicos ativos: ${technicians.map((t) => t.name).join(', ')}`);

  // ---------------------------------------------------------------------------------------------- 1. services
  const NEW_FROM = '2026-10-09';
  const existingServices = await q(
    `SELECT order_code, service_type, value, date_performed::text AS d, technician_id FROM services WHERE organization_id = $1 AND deleted_at IS NULL`,
    [ORG],
  );
  const typeValue = new Map();
  for (const row of existingServices) typeValue.set(row.service_type, Number(row.value));
  const types = [...typeValue.keys()];

  const DESCRIPTIONS = {
    'Elétrica': ['Troca de tomadas e interruptores da sala', 'Substituição de disjuntor do quadro', 'Reparo de curto no circuito da cozinha', 'Troca de fiação do chuveiro', 'Revisão elétrica do quadro de luz'],
    'Instalação/Ligação Elétrica': ['Instalação de luminárias no corredor', 'Ligação de ponto de força para ar-condicionado', 'Instalação de chuveiro elétrico', 'Instalação de ponto de tomada na bancada'],
    'Desentupimento': ['Desentupimento de pia da cozinha', 'Desentupimento de vaso sanitário', 'Desentupimento de ralo do banheiro', 'Desentupimento de coluna de esgoto'],
    'Hidráulica': ['Troca de torneira da pia', 'Reparo de vazamento no registro', 'Troca de sifão da pia do banheiro', 'Regulagem de boia da caixa d’água'],
    'Kit Fixação': ['Fixação de suporte de TV na parede', 'Instalação de prateleiras e suportes', 'Fixação de cortinas e varões', 'Instalação de suporte para microondas'],
    'Ventilador De Teto': ['Instalação de ventilador de teto no quarto', 'Troca de capacitor do ventilador', 'Montagem e instalação de ventilador na sala'],
    'Apoio Operacional Básico': ['Apoio na troca de box do banheiro', 'Pequenos reparos gerais na residência', 'Apoio operacional em reparo de bancada'],
    'Revisa/Repara Hidráulica': ['Revisão da rede hidráulica do apartamento', 'Reparo em flexível e engates', 'Reparo de vazamento na descarga'],
  };
  const descriptionFor = (type) => pick(DESCRIPTIONS[type] ?? ['Atendimento realizado']);

  // The old fixtures say "Dados de teste": give them a real description per type.
  const renamed = await q(`SELECT COUNT(*)::int AS n FROM services WHERE organization_id = $1 AND description = 'Dados de teste'`, [ORG]);
  if (renamed[0].n > 0) {
    for (const type of types) {
      const list = DESCRIPTIONS[type] ?? ['Atendimento realizado'];
      await q(
        `UPDATE services SET description = ($3::text[])[1 + floor(random() * $4)::int], updated_at = NOW()
         WHERE organization_id = $1 AND service_type = $2 AND description = 'Dados de teste'`,
        [ORG, type, list, list.length],
      );
    }
    log(`Serviços antigos: ${renamed[0].n} descrições trocadas por atendimentos reais.`);
  }

  // Who works when. Mon–Sat; a technician with no service on a past working day was off that day; a few days off ahead.
  const servicesByDay = new Map(); // `${tech}|${date}` -> n (existing)
  for (const row of existingServices) {
    const k = `${row.technician_id}|${row.d}`;
    servicesByDay.set(k, (servicesByDay.get(k) ?? 0) + 1);
  }
  const SCHEDULE_FROM = '2026-08-01';
  const SCHEDULE_TO = '2026-12-31';
  const HOLIDAYS = new Set(['2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25']);
  const OFF_NOTES = ['Folga', 'Folga compensada', 'Atestado médico', 'Banco de horas'];
  const scheduleRows = []; // { tech, date, start, end, status, notes }
  const worked = new Map(); // `${tech}|${date}` -> { start, end } for days a technician works
  for (const date of days(SCHEDULE_FROM, SCHEDULE_TO)) {
    if (dow(date) === 0 || (date >= NEW_FROM && HOLIDAYS.has(date))) continue;
    const saturday = dow(date) === 6;
    for (const t of technicians) {
      let off = false;
      if (date < NEW_FROM) off = (servicesByDay.get(`${t.id}|${date}`) ?? 0) === 0;
      else off = chance(0.035);
      const row = { tech: t.id, date, start: '08:00', end: saturday ? '14:00' : '18:00', status: off ? 'cancelled' : 'scheduled', notes: off ? pick(OFF_NOTES) : null };
      scheduleRows.push(row);
      if (!off) worked.set(`${t.id}|${date}`, { saturday });
    }
  }

  const alreadyNew = (await q(`SELECT COUNT(*)::int AS n FROM services WHERE organization_id = $1 AND deleted_at IS NULL AND date_performed >= $2`, [ORG, NEW_FROM]))[0].n;
  if (alreadyNew === 0) {
    const used = new Set(existingServices.map((row) => row.order_code));
    let counter = 2149100;
    const rows = [];
    for (const date of days(NEW_FROM, TODAY)) {
      if (dow(date) === 0 || HOLIDAYS.has(date)) continue;
      const saturday = dow(date) === 6;
      for (const t of technicians) {
        if (!worked.has(`${t.id}|${date}`)) continue;
        const count = date === TODAY ? int(1, 2) : saturday ? int(1, 3) : int(3, 6);
        for (let i = 0; i < count; i++) {
          let code;
          do {
            counter += int(1, 9);
            code = `09/${counter}-26`;
          } while (used.has(code));
          used.add(code);
          const type = pick(types);
          const hour = date === TODAY ? int(8, 10) : int(8, 17);
          rows.push({
            order_code: code,
            technician_id: t.id,
            service_type: type,
            value: typeValue.get(type),
            date_performed: date,
            time_performed: `${pad(hour)}:${pad(int(0, 59))}:00`,
            competence_month: monthOf(date),
            fortnight_period: Number(date.slice(8)) <= 15 ? 'Q1' : 'Q2',
            description: descriptionFor(type),
          });
        }
      }
    }
    await q(
      `INSERT INTO services (organization_id, order_code, technician_id, service_type, value, date_performed, time_performed, competence_month, fortnight_period, description)
       SELECT $2, order_code, technician_id, service_type, value, date_performed, time_performed, competence_month, fortnight_period, description
       FROM jsonb_to_recordset($1::jsonb) AS x(order_code text, technician_id uuid, service_type text, value numeric, date_performed date, time_performed time, competence_month text, fortnight_period text, description text)`,
      [JSON.stringify(rows), ORG],
    );
    log(`Serviços: ${rows.length} novos (09/10 a 09/11).`);
  } else {
    log('Serviços: já há serviços a partir de 09/10 — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 2. schedule
  const liveSchedule = (await q(`SELECT COUNT(*)::int AS n FROM schedule WHERE organization_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3`, [ORG, SCHEDULE_FROM, SCHEDULE_TO]))[0].n;
  if (liveSchedule < 400) {
    const archived = await q(`UPDATE schedule SET deleted_at = NOW(), updated_at = NOW() WHERE organization_id = $1 AND deleted_at IS NULL RETURNING id`, [ORG]);
    await q(
      `INSERT INTO schedule (organization_id, technician_id, date, start_time, end_time, status, notes)
       SELECT $2, tech, date, start::time, "end"::time, status::schedule_status, notes
       FROM jsonb_to_recordset($1::jsonb) AS x(tech uuid, date date, start text, "end" text, status text, notes text)`,
      [JSON.stringify(scheduleRows), ORG],
    );
    log(`Escala: ${archived.length} linhas antigas arquivadas; ${scheduleRows.length} novas (01/08 a 31/12).`);
  } else {
    log('Escala: já preenchida — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 3. work hours
  const liveHours = (await q(`SELECT COUNT(*)::int AS n FROM work_hours WHERE organization_id = $1 AND deleted_at IS NULL`, [ORG]))[0].n;
  if (liveHours === 0) {
    const rows = [];
    for (const [k, info] of worked) {
      const [techId, date] = k.split('|');
      if (date >= TODAY) continue; // the day is still running; the Porto import closes it at night
      const startMin = 8 * 60 + int(-10, 20);
      const grossMin = info.saturday ? int(5 * 60 + 30, 6 * 60 + 30) : int(9 * 60 + 10, 10 * 60 + 50);
      const endMin = startMin + grossMin;
      const net = Math.round(((grossMin - 60) / 60) * 100) / 100;
      const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
      rows.push({
        technician_id: techId,
        date,
        start_time: fmt(startMin),
        end_time: fmt(endMin),
        hours_worked: net,
        week_number: isoWeek(date),
        month: Number(date.slice(5, 7)),
        year: Number(date.slice(0, 4)),
      });
    }
    await q(
      `INSERT INTO work_hours (organization_id, technician_id, date, start_time, end_time, hours_worked, week_number, month, year, source)
       SELECT $2, technician_id, date, start_time, end_time, hours_worked, week_number, month, year, 'porto'
       FROM jsonb_to_recordset($1::jsonb) AS x(technician_id uuid, date date, start_time time, end_time time, hours_worked numeric, week_number int, month int, year int)`,
      [JSON.stringify(rows), ORG],
    );
    log(`Horas: ${rows.length} dias apontados.`);
  } else {
    log('Horas: já há apontamentos — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 4. discounts
  const liveDiscounts = (await q(`SELECT COUNT(*)::int AS n FROM discounts WHERE organization_id = $1 AND deleted_at IS NULL`, [ORG]))[0].n;
  if (liveDiscounts === 0) {
    const byName = Object.fromEntries(technicians.map((t) => [t.name, t.id]));
    const list = [
      ['Rafael Souza', 'advance', 300, 'Adiantamento salarial', '2026-08'],
      ['Diego Rocha', 'discount', 85, 'Multa de trânsito (veículo da empresa)', '2026-09'],
      ['Carlos Mendes', 'advance', 250, 'Adiantamento salarial', '2026-09'],
      ['Marcos Oliveira', 'advance', 400, 'Adiantamento salarial', '2026-10'],
      ['Bruno Lima', 'discount', 120, 'Uniforme e EPI', '2026-10'],
      ['Carlos Mendes', 'advance', 500, 'Adiantamento salarial', '2026-11'],
    ].filter((row) => byName[row[0]]);
    for (const [name, type, amount, reason, month] of list) {
      await q(`INSERT INTO discounts (organization_id, technician_id, type, amount, reason, competence_month) VALUES ($1, $2, $3, $4, $5, $6)`, [ORG, byName[name], type, amount, reason, month]);
    }
    log(`Descontos e adiantamentos: ${list.length}.`);
  } else {
    log('Descontos: já existem — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 5. finance
  const liveEntries = (await q(`SELECT COUNT(*)::int AS n FROM financial_entries WHERE organization_id = $1 AND deleted_at IS NULL`, [ORG]))[0].n;
  if (liveEntries === 0) {
    await q(
      `UPDATE organization_settings SET finance_categories = finance_categories || '["Seguro"]'::jsonb
       WHERE organization_id = $1 AND NOT (finance_categories @> '"Seguro"'::jsonb)`,
      [ORG],
    );

    const entries = []; // { id, type, description, category, supplier, amount, due, method, nature, series, n, total, recurring, notes, paid }
    let idCounter = 0;
    const uuid = () => crypto.randomUUID();
    const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
    const dueDate = (month, day) => `${month}-${pad(day)}`;
    const add = (e) => {
      const paid = e.forcePending ? false : e.due <= TODAY;
      entries.push({ id: uuid(), type: 'payable', supplier: null, method: null, nature: 'variable', series: null, n: 1, total: 1, recurring: false, notes: null, ...e, paid, order: idCounter++ });
    };

    // Fixed monthly bills, one series each (recurring).
    const fixed = [
      ['Aluguel da sede', 'Aluguel', 'Imobiliária Boa Vista', 3800, 5, 'boleto'],
      ['Internet e telefonia fixa', 'Internet', 'NetFibra Empresas', 289, 10, 'debit'],
      ['Planos de celular da equipe', 'Telefone', 'Conecta Móvel', 359, 15, 'boleto'],
      ['Seguro da frota', 'Seguro', 'Seguradora Horizonte', 1150, 8, 'boleto'],
      ['Anúncios online', 'Marketing', 'Agência Ponto Digital', 450, 3, 'card'],
      ['Contabilidade', 'Fornecedores', 'Contabilidade Prado & Associados', 780, 7, 'pix'],
    ];
    for (const [description, category, supplier, amount, day, method] of fixed) {
      const series = uuid();
      MONTHS.forEach((month, i) => add({ description, category, supplier, amount, due: dueDate(month, day), method, nature: 'fixed', series, n: i + 1, total: MONTHS.length, recurring: true, competence: month }));
    }
    // Van financing: installment 8 of 36 in August.
    {
      const series = uuid();
      MONTHS.forEach((month, i) =>
        add({ description: 'Financiamento da van (parcela)', category: 'Financiamento', supplier: 'Banco Primeira Linha', amount: 1480, due: dueDate(month, 12), method: 'debit', nature: 'fixed', series, n: 8 + i, total: 36, recurring: true, competence: month }),
      );
    }
    // Variable bills.
    MONTHS.forEach((month, i) => {
      add({ description: 'Conta de energia elétrica', category: 'Energia', supplier: 'Distribuidora de Energia', amount: round2(640 + rnd() * 160), due: dueDate(month, 12), method: 'boleto', nature: 'variable', competence: month });
      add({ description: 'Conta de água e esgoto', category: 'Água', supplier: 'Companhia de Águas', amount: round2(190 + rnd() * 50), due: dueDate(month, 15), method: 'boleto', competence: month });
      add({ description: 'Combustível da frota (cartão)', category: 'Combustível', supplier: 'Posto Central', amount: round2(3200 + rnd() * 900), due: dueDate(month, 20), method: 'card', competence: month });
      add({ description: 'Manutenção dos veículos', category: 'Manutenção', supplier: 'Oficina Mecânica Irmãos Lopes', amount: round2(800 + rnd() * 800), due: dueDate(month, 18), method: 'pix', competence: month });
      add({ description: 'Imposto mensal (Simples Nacional)', category: 'Impostos', supplier: 'Receita Federal', amount: round2(3400 + rnd() * 800), due: dueDate(month, 20), method: 'boleto', competence: month });
      add({ description: 'Materiais e ferramentas', category: 'Fornecedores', supplier: 'Casa & Obra Materiais', amount: round2(900 + rnd() * 700), due: dueDate(month, 9), method: 'boleto', competence: month });
      add({ description: 'Compra de peças para estoque', category: 'Fornecedores', supplier: 'Eletro Peças Distribuidora', amount: round2(1100 + rnd() * 1200), due: dueDate(month, 25), method: 'boleto', competence: month });
      if (i < 4) add({ description: 'Fatura do cartão corporativo', category: 'Cartão de crédito', supplier: 'Banco Primeira Linha', amount: round2(1200 + rnd() * 900), due: dueDate(month, 28), method: 'card', competence: month });
    });
    // Two bills still open and already due, so the alerts have something to say.
    const overdue = entries.find((e) => e.description === 'Materiais e ferramentas' && e.due === '2026-10-09');
    if (overdue) overdue.paid = false;
    const overdue2 = entries.find((e) => e.description === 'Compra de peças para estoque' && e.due === '2026-10-25');
    if (overdue2) overdue2.paid = false;

    // Receivables: the insurer's fortnight transfers (from the services themselves) and monthly maintenance contracts.
    const fortnights = await q(
      `SELECT competence_month AS month, fortnight_period AS q, SUM(value)::numeric AS total FROM services
       WHERE organization_id = $1 AND deleted_at IS NULL AND competence_month <= '2026-10' GROUP BY 1, 2 ORDER BY 1, 2`,
      [ORG],
    );
    for (const f of fortnights) {
      const due = f.q === 'Q1' ? dueDate(f.month, 25) : dueDate(addMonth(f.month, 1), 10);
      add({ type: 'receivable', description: `Repasse da seguradora — ${f.q === 'Q1' ? '1ª' : '2ª'} quinzena`, category: 'Geral', supplier: 'Seguradora parceira', amount: round2(Number(f.total)), due, method: 'transfer', nature: 'variable', competence: f.month });
    }
    MONTHS.forEach((month) => {
      add({ type: 'receivable', description: 'Contrato de manutenção — Condomínio Jardim das Palmeiras', category: 'Geral', supplier: 'Condomínio Jardim das Palmeiras', amount: 1800, due: dueDate(month, 5), method: 'pix', nature: 'fixed', recurring: true, competence: month });
      add({ type: 'receivable', description: 'Contrato de manutenção predial — Lojas Horizonte', category: 'Geral', supplier: 'Rede de Lojas Horizonte', amount: 2600, due: dueDate(month, 10), method: 'boleto', nature: 'fixed', recurring: true, competence: month });
    });
    // The Nov-10 contract payment is due tomorrow: still open.

    const payload = entries.map((e) => ({
      id: e.id, type: e.type, description: e.description, category: e.category, supplier: e.supplier, amount: e.amount, due_date: e.due,
      competence_month: e.competence ?? monthOf(e.due), status: e.paid ? 'paid' : 'pending', paid_amount: e.paid ? e.amount : 0,
      paid_at: e.paid ? addDays(e.due, e.type === 'payable' && e.method !== 'debit' && e.method !== 'card' ? -int(0, 2) : int(0, 1)) : null,
      payment_method: e.method, nature: e.nature, series_id: e.series, installment_number: e.n, installment_total: e.total, is_recurring: e.recurring, notes: e.notes,
    }));
    for (const p of payload) if (p.paid_at && p.paid_at > TODAY) p.paid_at = TODAY;
    await q(
      `INSERT INTO financial_entries (id, organization_id, type, description, category, supplier, amount, due_date, competence_month, status, paid_amount, paid_at, payment_method, nature, series_id, installment_number, installment_total, is_recurring, notes)
       SELECT id, $2, type, description, category, supplier, amount, due_date, competence_month, status, paid_amount, paid_at, payment_method, nature, series_id, installment_number, installment_total, is_recurring, notes
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, type text, description text, category text, supplier text, amount numeric, due_date date, competence_month text, status text, paid_amount numeric, paid_at date, payment_method text, nature text, series_id text, installment_number int, installment_total int, is_recurring boolean, notes text)`,
      [JSON.stringify(payload), ORG],
    );
    await q(
      `INSERT INTO financial_payments (organization_id, entry_id, amount, paid_at, method, created_by)
       SELECT $1, id, paid_amount, paid_at, payment_method, $2 FROM financial_entries
       WHERE organization_id = $1 AND status = 'paid' AND paid_at IS NOT NULL AND deleted_at IS NULL`,
      [ORG, ADMIN_ID],
    );
    log(`Despesas: ${payload.length} lançamentos (${payload.filter((p) => p.status === 'paid').length} quitados).`);

    // Monthly budgets per category.
    const budgets = { Aluguel: 3800, Energia: 800, 'Água': 250, Internet: 300, Telefone: 400, 'Combustível': 3800, 'Manutenção': 1500, Fornecedores: 5200, Impostos: 4200, Marketing: 500, Seguro: 1200, Financiamento: 1480, 'Cartão de crédito': 2000 };
    for (const [category, amount] of Object.entries(budgets)) {
      const updated = await q(`UPDATE finance_budgets SET amount = $3, updated_at = NOW() WHERE organization_id = $1 AND category = $2 RETURNING category`, [ORG, category, amount]);
      if (!updated.length) await q(`INSERT INTO finance_budgets (organization_id, category, amount) VALUES ($1, $2, $3)`, [ORG, category, amount]);
    }
    log(`Orçamento: ${Object.keys(budgets).length} categorias.`);
  } else {
    log('Despesas: já existem lançamentos — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 6. parts
  const partCount = (await q(`SELECT COUNT(*)::int AS n FROM parts WHERE organization_id = $1 AND deleted_at IS NULL`, [ORG]))[0].n;
  if (partCount <= 1) {
    await seedParts();
  } else {
    log('Peças: o catálogo já está preenchido — pulado.');
  }

  // ---------------------------------------------------------------------------------------------- 7. notifications
  const recentNotes = (await q(`SELECT COUNT(*)::int AS n FROM notifications WHERE organization_id = $1 AND dedupe_key LIKE 'demo:%'`, [ORG]))[0].n;
  if (recentNotes === 0) {
    const notes = [
      ['expenses', 'warning', 'Contas a vencer', '2 contas vencem nos próximos 3 dias. Confira em Despesas.', '/admin/despesas', '2026-11-09 08:00'],
      ['expenses', 'critical', 'Conta em atraso', 'A conta "Compra de peças para estoque" venceu em 25/10 e ainda não foi paga.', '/admin/despesas', '2026-11-09 08:00'],
      ['payroll', 'warning', 'Folha de novembro em rascunho', 'A folha de novembro ainda não foi fechada.', '/admin/payroll', '2026-11-08 18:00'],
      ['parts', 'info', 'Estoque baixo de peças', 'Algumas peças do estoque central estão abaixo do mínimo. Veja em Venda de Peças.', '/admin/pecas', '2026-11-07 09:00'],
      ['technician', 'success', 'Remessa confirmada', 'Marcos Oliveira confirmou o recebimento da remessa de peças.', '/admin/pecas', '2026-11-04 10:30'],
    ];
    for (const [kind, severity, title, body, href, when] of notes) {
      await q(
        `INSERT INTO notifications (organization_id, kind, severity, title, body, href, audience, dedupe_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'admins', $7, $8::timestamptz)`,
        [ORG, kind, severity, title, body, href, `demo:${title}`, `${when.replace(' ', 'T')}:00-03:00`],
      );
    }
    log(`Notificações: ${notes.length}.`);
  }

  if (DRY) {
    await client.query('ROLLBACK');
    log('\n--dry: tudo desfeito (ROLLBACK).');
  } else {
    await client.query('COMMIT');
    log('\nGravado. Agora rode: node scripts/seed-kappa-payroll.cjs');
  }

  // ================================================================================================ parts
  async function seedParts() {
    const settings = (await q(`SELECT 1 FROM parts_settings WHERE organization_id = $1`, [ORG]))[0];
    if (!settings) {
      await q(
        `INSERT INTO parts_settings (organization_id, receipt_footer, settlement_day, company_name) VALUES ($1, $2, 10, 'Kappa Assistência Técnica')`,
        [ORG, 'Obrigado pela preferência! Garantia de 90 dias nas peças instaladas.'],
      );
    }

    // [name, category, brand, unit, cost, min stock, central purchase qty]
    const CATALOG = [
      ['Torneira de cozinha 1/2" metal', 'Hidráulica', 'Hidrotec', 'un', 48, 4, 24],
      ['Sifão sanfonado universal', 'Hidráulica', 'Hidrotec', 'un', 9.5, 10, 60],
      ['Registro de gaveta 3/4"', 'Hidráulica', 'Hidrotec', 'un', 36, 4, 20],
      ['Boia para caixa d’água 1/2"', 'Hidráulica', 'Hidrotec', 'un', 14, 6, 30],
      ['Kit reparo de caixa acoplada', 'Hidráulica', 'Hidrotec', 'un', 29, 5, 24],
      ['Fita veda-rosca 18 mm', 'Hidráulica', 'Hidrotec', 'un', 4.2, 20, 120],
      ['Flexível inox 40 cm', 'Hidráulica', 'Hidrotec', 'un', 11, 10, 60],
      ['Engate trançado 1/2"', 'Hidráulica', 'Hidrotec', 'un', 13, 8, 40],
      ['Produto desentupidor 1 L', 'Hidráulica', 'Hidrotec', 'un', 17, 6, 36],
      ['Disjuntor monopolar 20 A', 'Elétrica', 'Eletromax', 'un', 12, 10, 50],
      ['Disjuntor bipolar 40 A', 'Elétrica', 'Eletromax', 'un', 38, 4, 20],
      ['Tomada 2P+T 10 A', 'Elétrica', 'Eletromax', 'un', 8.5, 15, 80],
      ['Interruptor simples', 'Elétrica', 'Eletromax', 'un', 7.5, 15, 80],
      ['Fio flexível 2,5 mm (rolo 100 m)', 'Elétrica', 'Eletromax', 'rolo', 215, 2, 10],
      ['Fita isolante 20 m', 'Elétrica', 'Eletromax', 'un', 6.5, 20, 100],
      ['Lâmpada LED 9 W', 'Elétrica', 'Eletromax', 'un', 6.9, 20, 100],
      ['Chuveiro elétrico 5500 W', 'Elétrica', 'Eletromax', 'un', 72, 3, 15],
      ['Resistência de chuveiro', 'Elétrica', 'Eletromax', 'un', 18, 8, 40],
      ['Ventilador de teto 3 pás', 'Ventilação', 'ArFlux', 'un', 165, 2, 12],
      ['Capacitor para ventilador 3 µF', 'Ventilação', 'ArFlux', 'un', 11, 6, 30],
      ['Controle remoto universal para ventilador', 'Ventilação', 'ArFlux', 'un', 24, 4, 20],
      ['Bucha 8 mm (cento)', 'Fixação', 'FixPro', 'cento', 11, 10, 50],
      ['Parafuso 4,5 x 50 mm (cento)', 'Fixação', 'FixPro', 'cento', 14, 10, 50],
      ['Suporte de TV articulado', 'Fixação', 'FixPro', 'un', 58, 3, 16],
      ['Abraçadeira de nylon (cento)', 'Fixação', 'FixPro', 'cento', 12, 6, 30],
      ['Suporte para microondas', 'Fixação', 'FixPro', 'un', 39, 3, 14],
    ];
    const niceTech = (cost) => Math.round(cost * (1.35 + rnd() * 0.15) * 2) / 2;
    const niceSug = (tech) => Math.ceil(tech * (1.3 + rnd() * 0.15)) - 0.1;
    const ean = (i) => `789${String(26110000 + i * 137).padStart(9, '0')}${i % 10}`;

    // The old fixture part: tidy it and give it the identity of a catalog part.
    const old = (await q(`SELECT id FROM parts WHERE organization_id = $1 AND deleted_at IS NULL LIMIT 1`, [ORG]))[0];
    const parts = []; // { id, name, cost, tech, sug, min, buy }
    if (old) {
      await q(`UPDATE parts SET name = 'Cabo de aço para varal 10 m', category = 'Fixação', brand = 'FixPro', updated_at = NOW() WHERE id = $1`, [old.id]);
      const row = (await q(`SELECT id, name, cost_price, technician_price, suggested_price, min_stock FROM parts WHERE id = $1`, [old.id]))[0];
      parts.push({ id: row.id, name: row.name, cost: Number(row.cost_price), tech: Number(row.technician_price), sug: Number(row.suggested_price), min: 2, buy: 0 });
    }
    for (let i = 0; i < CATALOG.length; i++) {
      const [name, category, brand, unit, cost, min, buy] = CATALOG[i];
      const tech = niceTech(cost);
      const sug = niceSug(tech);
      const created = await q(
        `INSERT INTO parts (organization_id, name, barcode, sku, category, brand, unit, cost_price, technician_price, suggested_price, min_stock, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $13::timestamptz) RETURNING id`,
        [ORG, name, ean(i + 1), `KP-${String(i + 1).padStart(3, '0')}`, category, brand, unit, cost, tech, sug, min, ADMIN_ID, at('2026-08-03', 9)],
      );
      parts.push({ id: created[0].id, name, cost, tech, sug, min, buy });
    }
    log(`Peças: ${CATALOG.length} novas no catálogo.`);

    // Running stock ledger: key `${techId|'central'}|${partId}`.
    const stock = new Map();
    const get = (holder, partId) => stock.get(`${holder}|${partId}`) ?? 0;
    const bump = (holder, partId, n) => stock.set(`${holder}|${partId}`, get(holder, partId) + n);
    const existingMov = await q(`SELECT part_id, technician_id, quantity FROM part_movements WHERE organization_id = $1`, [ORG]);
    for (const m of existingMov) bump(m.technician_id ?? 'central', m.part_id, m.quantity);

    const movements = []; // { part, tech, qty, kind, cost, techPrice, transfer, sale, inventory, note, by, when }
    const mov = (m) => movements.push(m);
    const transfers = []; // { id, number, tech, direction, totalTech, totalCost, when, ack, note }
    const sales = [];
    const accounts = []; // part_account_entries
    let transferNo = (await q(`SELECT COALESCE(MAX(number), 0) AS n FROM part_transfers WHERE organization_id = $1`, [ORG]))[0].n;
    let inventoryNo = (await q(`SELECT COALESCE(MAX(number), 0) AS n FROM part_inventories WHERE organization_id = $1`, [ORG]))[0].n;
    let saleNo = 0;
    let debtNo = 0;
    const uuid = () => crypto.randomUUID();
    const techById = Object.fromEntries(technicians.map((t) => [t.id, t]));

    const catalogParts = parts.filter((p) => p.buy > 0);
    const purchase = (partRows, date, note) => {
      for (const p of partRows) {
        const qty = Math.max(2, Math.round((p.buy || 10) * (0.5 + rnd() * 0.6)));
        bump('central', p.id, qty);
        mov({ part: p.id, tech: null, qty, kind: 'purchase', cost: round2(p.cost * (0.97 + rnd() * 0.08)), techPrice: p.tech, note, by: ADMIN_ID, when: at(date, int(9, 11), int(0, 59)) });
      }
    };

    // Consignment shipments to the technicians.
    const shipment = (date, hour, { refill }) => {
      for (const t of technicians) {
        const chosen = refill ? parts.filter((p) => get(t.id, p.id) <= 1 && chance(0.6)) : [...parts].sort(() => rnd() - 0.5).slice(0, int(9, 12));
        const items = [];
        for (const p of chosen) {
          const qty = Math.min(get('central', p.id), p.tech > 150 ? int(1, 2) : int(3, 8));
          if (qty > 0) items.push({ p, qty });
        }
        if (!items.length) continue;
        transferNo += 1;
        const id = uuid();
        const when = at(date, hour, int(0, 40));
        transfers.push({
          id, number: transferNo, tech: t.id, direction: 'out', when, by: ADMIN_ID,
          totalTech: round2(items.reduce((sum, i) => sum + i.qty * i.p.tech, 0)), totalCost: round2(items.reduce((sum, i) => sum + i.qty * i.p.cost, 0)),
          ack: date < '2026-11-03' || chance(0.5) ? at(date, hour + 2, int(0, 50)) : null,
        });
        for (const { p, qty } of items) {
          bump('central', p.id, -qty);
          bump(t.id, p.id, qty);
          mov({ part: p.id, tech: null, qty: -qty, kind: 'transfer', cost: p.cost, techPrice: p.tech, transfer: id, by: ADMIN_ID, when });
          mov({ part: p.id, tech: t.id, qty, kind: 'transfer', cost: p.cost, techPrice: p.tech, transfer: id, by: ADMIN_ID, when });
        }
      }
    };

    // Rafael returns two parts that were not moving.
    const returnParts = (date) => {
      const t = technicians.find((x) => x.name === 'Rafael Souza') ?? technicians[0];
      const items = parts.filter((p) => get(t.id, p.id) >= 3).slice(0, 2).map((p) => ({ p, qty: 2 }));
      if (!items.length) return;
      transferNo += 1;
      const id = uuid();
      const when = at(date, 16, 10);
      transfers.push({
        id, number: transferNo, tech: t.id, direction: 'return', when, by: ADMIN_ID, note: 'Devolução de peças sem giro', ack: at(date, 16, 30),
        totalTech: round2(items.reduce((sum, i) => sum + i.qty * i.p.tech, 0)), totalCost: round2(items.reduce((sum, i) => sum + i.qty * i.p.cost, 0)),
      });
      for (const { p, qty } of items) {
        bump(t.id, p.id, -qty);
        bump('central', p.id, qty);
        mov({ part: p.id, tech: t.id, qty: -qty, kind: 'transfer', cost: p.cost, techPrice: p.tech, transfer: id, by: ADMIN_ID, when });
        mov({ part: p.id, tech: null, qty, kind: 'transfer', cost: p.cost, techPrice: p.tech, transfer: id, by: ADMIN_ID, when });
      }
    };

    // Inventory on Diego's car: two parts short (charged in 3 installments) and one absorbed by the company.
    const inventories = [];
    const debts = [];
    const diego = technicians.find((t) => t.name === 'Diego Rocha') ?? technicians[1];
    const carInventory = (date) => {
      const held = parts.filter((p) => get(diego.id, p.id) >= 2);
      if (held.length < 3) return;
      inventoryNo += 1;
      const inv = { id: uuid(), number: inventoryNo, tech: diego.id, items: [], when: at(date, 9, 0), closedAt: at(date, 11, 20), shortage: 0 };
      const plan = [{ p: held[0], resolution: 'charge' }, { p: held[1], resolution: 'charge' }, { p: held[2], resolution: 'absorb' }];
      for (const item of plan) {
        const expected = get(diego.id, item.p.id);
        inv.items.push({ part: item.p.id, counted: expected - 1, expected, techPrice: item.p.tech, resolution: item.resolution });
        bump(diego.id, item.p.id, -1);
        mov({ part: item.p.id, tech: diego.id, qty: -1, kind: 'inventory_shortage', techPrice: item.p.tech, inventory: inv.id, note: `Inventário nº ${inv.number}`, by: ADMIN_ID, when: inv.closedAt });
        if (item.resolution === 'charge') inv.shortage += item.p.tech;
      }
      inv.shortage = round2(inv.shortage);
      inventories.push(inv);
      debtNo += 1;
      const debt = { id: uuid(), number: debtNo, tech: diego.id, inventory: inv.id, total: inv.shortage, installments: 3, first: addMonth(monthOf(date), 1), when: at(date, 11, 30) };
      debts.push(debt);
      const each = round2(debt.total / 3);
      [each, each, round2(debt.total - each * 2)].forEach((value, i) =>
        accounts.push({ tech: diego.id, kind: 'debt_installment', amount: value, month: addMonth(debt.first, i), debt: debt.id, installment: i + 1, description: `Parcela ${i + 1}/3 — débito de peças`, when: debt.when, by: ADMIN_ID }),
      );
    };

    // A count of the central stock that finds one extra unit.
    const centralInventory = (date) => {
      const p = parts.find((x) => x.buy > 0 && get('central', x.id) > 4);
      if (!p) return;
      inventoryNo += 1;
      const expected = get('central', p.id);
      const inv = { id: uuid(), number: inventoryNo, tech: null, items: [{ part: p.id, counted: expected + 1, expected, techPrice: p.tech, resolution: null }], when: at(date, 9, 0), closedAt: at(date, 10, 40), shortage: 0 };
      bump('central', p.id, 1);
      mov({ part: p.id, tech: null, qty: 1, kind: 'inventory_surplus', techPrice: p.tech, inventory: inv.id, note: `Inventário nº ${inv.number}`, by: ADMIN_ID, when: inv.closedAt });
      inventories.push(inv);
    };

    // Sales by the technicians, from their own stock.
    const CUSTOMERS = ['Marina Duarte', 'Paulo Henrique Alves', 'Condomínio Solar das Acácias', 'Fernanda Lopes', 'Roberto Castro', 'Juliana Nogueira', 'Edifício Vila Rica', 'Antônio Carvalho', 'Luciana Prates', 'Restaurante Sabor da Casa', 'Cláudio Ramos', 'Patrícia Moura', 'Sérgio Batista', 'Vanessa Teixeira', 'Padaria Pão Quente', 'Helena Vasconcelos'];
    const METHODS = ['pix', 'pix', 'pix', 'pix', 'card_link', 'card_link', 'card_present', 'card_present', 'cash'];
    let canceledLeft = 2;
    const daySales = (date) => {
      for (const t of technicians) {
        if (!chance(date >= '2026-10-01' ? 0.34 : 0.3)) continue;
        const available = parts.filter((p) => get(t.id, p.id) > 0);
        if (!available.length) continue;
        const lines = [];
        const used = new Set();
        const wanted = int(1, 3);
        for (let i = 0; i < wanted; i++) {
          const p = pick(available);
          if (used.has(p.id)) continue;
          used.add(p.id);
          const qty = Math.min(get(t.id, p.id), p.tech > 150 ? 1 : int(1, 2));
          if (qty <= 0) continue;
          // Price to the customer: around the suggested price, never under the technician's price.
          lines.push({ p, qty, price: Math.max(p.tech, round2(p.sug * (0.92 + rnd() * 0.2))) });
        }
        if (!lines.length) continue;
        saleNo += 1;
        const id = uuid();
        const when = at(date, int(9, 17), int(0, 59));
        const method = pick(METHODS);
        const canceled = canceledLeft > 0 && date > '2026-10-15' && chance(0.12);
        if (canceled) canceledLeft -= 1;
        const nextDay = addDays(date, 1);
        const cancelDate = canceled ? (chance(0.5) && nextDay <= TODAY ? nextDay : date) : null;
        const by = techById[t.id].user_id ?? ADMIN_ID;
        const totalTech = round2(lines.reduce((sum, l) => sum + l.qty * l.p.tech, 0));
        sales.push({
          id, number: saleNo, tech: t.id, customer: pick(CUSTOMERS), method, when, by, canceled, cancelDate, lines, totalTech,
          total: round2(lines.reduce((sum, l) => sum + l.qty * l.price, 0)), totalCost: round2(lines.reduce((sum, l) => sum + l.qty * l.p.cost, 0)),
          paidAt: new Date(new Date(when).getTime() + (method === 'cash' ? int(0, 3) * 3600000 : int(2, 40) * 60000)).toISOString(),
        });
        for (const l of lines) {
          bump(t.id, l.p.id, -l.qty);
          mov({ part: l.p.id, tech: t.id, qty: -l.qty, kind: 'sale', cost: l.p.cost, techPrice: l.p.tech, sale: id, by, when });
          if (canceled) {
            bump(t.id, l.p.id, l.qty);
            mov({ part: l.p.id, tech: t.id, qty: l.qty, kind: 'sale_canceled', cost: l.p.cost, techPrice: l.p.tech, sale: id, note: 'Cliente desistiu da compra', by: ADMIN_ID, when: at(cancelDate, 18, 30) });
          }
        }
        accounts.push({ tech: t.id, kind: 'sale', amount: totalTech, month: monthOf(date), sale: id, description: `Venda nº ${saleNo}`, when, by });
        if (canceled) accounts.push({ tech: t.id, kind: 'sale_canceled', amount: -totalTech, month: monthOf(date), sale: id, description: `Venda nº ${saleNo} cancelada: Cliente desistiu da compra`, when: at(cancelDate, 18, 30), by: ADMIN_ID });
      }
    };

    // Run the months day by day, so the stock is always what it was on that day.
    for (const date of days('2026-08-03', '2026-11-08')) {
      if (date === '2026-08-03') purchase(catalogParts, date, 'Compra inicial do estoque');
      if (date === '2026-09-14') purchase(catalogParts.filter(() => chance(0.5)), date, 'Reposição de estoque');
      if (date === '2026-10-13') purchase(catalogParts.filter(() => chance(0.5)), date, 'Reposição de estoque');
      if (date === '2026-11-04') purchase(catalogParts.filter(() => chance(0.4)), date, 'Reposição de estoque');
      if (date === '2026-08-05') shipment(date, 10, { refill: false });
      if (['2026-09-02', '2026-10-01', '2026-11-03'].includes(date)) shipment(date, 10, { refill: true });
      if (date === '2026-09-28') centralInventory(date);
      if (date === '2026-10-20') returnParts(date);
      if (dow(date) !== 0 && !HOLIDAYS.has(date) && date >= '2026-08-10') daySales(date);
      if (date === '2026-10-20') carInventory(date);
    }

    // Settlement: August and September are paid (after the settlement day, the 10th); October is still open.
    const balance = (tech, month) => round2(accounts.filter((a) => a.tech === tech && a.month === month && (a.kind === 'sale' || a.kind === 'sale_canceled')).reduce((s, a) => s + a.amount, 0));
    const PAY_METHODS = ['pix', 'transfer', 'cash'];
    technicians.forEach((t, index) => {
      for (const month of ['2026-08', '2026-09']) {
        const owed = balance(t.id, month);
        if (owed <= 0) continue;
        const payDate = `${addMonth(month, 1)}-${pad(int(8, 12))}`;
        const partial = index === 2 && month === '2026-09'; // one technician still owes part of September
        const deduction = index === 0 && month === '2026-08' && owed > 100;
        const amount = partial ? round2(owed * 0.6) : owed;
        const method = deduction ? 'deduction' : pick(PAY_METHODS);
        accounts.push({ tech: t.id, kind: 'payment', amount: -amount, month, method, description: deduction ? 'Desconto na folha de agosto (acordado)' : `Pagamento — ${method === 'pix' ? 'Pix' : method === 'cash' ? 'Dinheiro' : 'Transferência'}`, when: at(payDate, int(9, 16), int(0, 59)), by: ADMIN_ID });
      }
      if (index < 2) {
        const owed = balance(t.id, '2026-10');
        if (owed > 0) accounts.push({ tech: t.id, kind: 'payment', amount: -owed, month: '2026-10', method: 'pix', description: 'Pagamento — Pix', when: at('2026-11-06', 14, 20), by: ADMIN_ID });
      }
    });

    // ---- write everything
    const jt = (rows) => JSON.stringify(rows);
    await q(
      `INSERT INTO part_transfers (id, organization_id, number, technician_id, direction, total_technician_price, total_cost, note, created_at, created_by, acknowledged_at, acknowledged_by, acknowledged_ip)
       SELECT id, $2, number, technician_id, direction, total_tech, total_cost, note, created_at, created_by, acknowledged_at, CASE WHEN acknowledged_at IS NULL THEN NULL ELSE technician_user END, CASE WHEN acknowledged_at IS NULL THEN NULL ELSE '203.0.113.20' END
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, number int, technician_id uuid, direction text, total_tech numeric, total_cost numeric, note text, created_at timestamptz, created_by uuid, acknowledged_at timestamptz, technician_user uuid)`,
      [jt(transfers.map((t) => ({ id: t.id, number: t.number, technician_id: t.tech, direction: t.direction, total_tech: t.totalTech, total_cost: t.totalCost, note: t.note ?? null, created_at: t.when, created_by: t.by, acknowledged_at: t.ack, technician_user: techById[t.tech]?.user_id ?? null }))), ORG],
    );
    await q(
      `INSERT INTO part_inventories (id, organization_id, number, technician_id, status, note, started_at, started_by, closed_at, closed_by, shortage_value, surplus_units)
       SELECT id, $2, number, technician_id, 'closed', note, started_at, $3, closed_at, $3, shortage, surplus FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, number int, technician_id uuid, note text, started_at timestamptz, closed_at timestamptz, shortage numeric, surplus int)`,
      [jt(inventories.map((i) => ({ id: i.id, number: i.number, technician_id: i.tech, note: i.tech ? 'Contagem do carro' : 'Contagem do estoque central', started_at: i.when, closed_at: i.closedAt, shortage: i.tech ? i.shortage : null, surplus: i.tech ? null : 1 }))), ORG, ADMIN_ID],
    );
    await q(
      `INSERT INTO part_inventory_items (organization_id, inventory_id, part_id, counted, expected, unit_technician_price, resolution)
       SELECT $2, inventory_id, part_id, counted, expected, unit_tech, resolution FROM jsonb_to_recordset($1::jsonb) AS x(inventory_id uuid, part_id uuid, counted int, expected int, unit_tech numeric, resolution text)`,
      [jt(inventories.flatMap((i) => i.items.map((it) => ({ inventory_id: i.id, part_id: it.part, counted: it.counted, expected: it.expected, unit_tech: it.techPrice, resolution: it.resolution })))), ORG],
    );
    await q(
      `INSERT INTO part_sales (id, organization_id, number, technician_id, customer_name, status, payment_method, total_amount, total_technician_price, total_cost, mp_status, payment_attempts, paid_at, payment_confirmed_by, receipt_sent_at, created_at, created_by, canceled_at, canceled_by, cancel_reason)
       SELECT id, $2, number, technician_id, customer_name, status, payment_method, total_amount, total_tech, total_cost,
              CASE WHEN payment_method = 'cash' OR status = 'canceled' THEN NULL ELSE 'approved' END, CASE WHEN payment_method = 'cash' THEN 0 ELSE 1 END,
              CASE WHEN status = 'canceled' THEN NULL ELSE paid_at END, CASE WHEN status = 'canceled' THEN NULL WHEN payment_method = 'cash' THEN 'technician' ELSE 'mercadopago' END,
              CASE WHEN status = 'paid' THEN paid_at ELSE NULL END, created_at, created_by, canceled_at, CASE WHEN status = 'canceled' THEN $3::uuid ELSE NULL END, cancel_reason
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, number int, technician_id uuid, customer_name text, status text, payment_method text, total_amount numeric, total_tech numeric, total_cost numeric, paid_at timestamptz, created_at timestamptz, created_by uuid, canceled_at timestamptz, cancel_reason text)`,
      [jt(sales.map((s) => ({ id: s.id, number: s.number, technician_id: s.tech, customer_name: s.customer, status: s.canceled ? 'canceled' : 'paid', payment_method: s.method, total_amount: s.total, total_tech: s.totalTech, total_cost: s.totalCost, paid_at: s.paidAt, created_at: s.when, created_by: s.by, canceled_at: s.canceled ? at(s.cancelDate, 18, 30) : null, cancel_reason: s.canceled ? 'Cliente desistiu da compra' : null }))), ORG, ADMIN_ID],
    );
    await q(
      `INSERT INTO part_sale_items (organization_id, sale_id, part_id, part_name, quantity, unit_price, unit_technician_price, unit_cost)
       SELECT $2, sale_id, part_id, part_name, quantity, unit_price, unit_tech, unit_cost FROM jsonb_to_recordset($1::jsonb) AS x(sale_id uuid, part_id uuid, part_name text, quantity int, unit_price numeric, unit_tech numeric, unit_cost numeric)`,
      [jt(sales.flatMap((s) => s.lines.map((l) => ({ sale_id: s.id, part_id: l.p.id, part_name: l.p.name, quantity: l.qty, unit_price: l.price, unit_tech: l.p.tech, unit_cost: l.p.cost })))), ORG],
    );
    await q(
      `INSERT INTO part_debts (id, organization_id, number, technician_id, inventory_id, description, total_amount, installments, first_due_month, status, created_at, created_by, acknowledged_at, acknowledged_by, acknowledged_ip)
       SELECT id, $2, number, technician_id, inventory_id, 'Falta apurada no inventário do carro', total, installments, first_due_month, 'active', created_at, $3, created_at + interval '1 day', technician_user, '203.0.113.21'
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, number int, technician_id uuid, inventory_id uuid, total numeric, installments int, first_due_month text, created_at timestamptz, technician_user uuid)`,
      [jt(debts.map((d) => ({ id: d.id, number: d.number, technician_id: d.tech, inventory_id: d.inventory, total: d.total, installments: d.installments, first_due_month: d.first, created_at: d.when, technician_user: techById[d.tech]?.user_id ?? null }))), ORG, ADMIN_ID],
    );
    await q(
      `INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, transfer_id, sale_id, inventory_id, note, created_at, created_by)
       SELECT $2, part_id, technician_id, quantity, kind, unit_cost, unit_tech, transfer_id, sale_id, inventory_id, note, created_at, created_by
       FROM jsonb_to_recordset($1::jsonb) AS x(part_id uuid, technician_id uuid, quantity int, kind text, unit_cost numeric, unit_tech numeric, transfer_id uuid, sale_id uuid, inventory_id uuid, note text, created_at timestamptz, created_by uuid)
       ORDER BY created_at`,
      [jt(movements.map((m) => ({ part_id: m.part, technician_id: m.tech, quantity: m.qty, kind: m.kind, unit_cost: m.cost ?? null, unit_tech: m.techPrice ?? null, transfer_id: m.transfer ?? null, sale_id: m.sale ?? null, inventory_id: m.inventory ?? null, note: m.note ?? null, created_at: m.when, created_by: m.by }))), ORG],
    );
    await q(
      `INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, sale_id, debt_id, installment, payment_method, description, created_at, created_by)
       SELECT $2, technician_id, kind, amount, due_month, sale_id, debt_id, installment, payment_method, description, created_at, created_by
       FROM jsonb_to_recordset($1::jsonb) AS x(technician_id uuid, kind text, amount numeric, due_month text, sale_id uuid, debt_id uuid, installment int, payment_method text, description text, created_at timestamptz, created_by uuid)`,
      [jt(accounts.map((a) => ({ technician_id: a.tech, kind: a.kind, amount: a.amount, due_month: a.month, sale_id: a.sale ?? null, debt_id: a.debt ?? null, installment: a.installment ?? null, payment_method: a.method ?? null, description: a.description, created_at: a.when, created_by: a.by }))), ORG],
    );
    // The old fixture shipment (#1) was never acknowledged: confirm it.
    await q(`UPDATE part_transfers SET acknowledged_at = created_at + interval '2 hours' WHERE organization_id = $1 AND number = 1 AND acknowledged_at IS NULL`, [ORG]);

    const negatives = [...stock.entries()].filter(([, n]) => n < 0);
    if (negatives.length) throw new Error(`Estoque negativo em ${negatives.length} posição(ões) — abortando.`);
    log(`Peças: ${transfers.length} remessas, ${sales.length} vendas (${sales.filter((s) => s.canceled).length} canceladas), ${movements.length} movimentos, ${inventories.length} inventários, ${debts.length} débito(s), ${accounts.length} lançamentos na conta dos técnicos.`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFalhou, nada foi gravado:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
