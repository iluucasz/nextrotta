// Second half of the Kappa demo seed (see scripts/seed-kappa-demo.mjs): calculates the payroll with the app's own
// rules (lib/payroll-utils.ts) for the demo months, closes August to October, leaves November as a draft, and posts the
// matching "Folha" bills in Despesas. Writes only to the organization with slug "kappa" (must be a test organization).
//
//   node scripts/seed-kappa-payroll.cjs
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);

const TODAY = '2026-11-09';
const CLOSED_MONTHS = ['2026-08', '2026-09', '2026-10'];
const DRAFT_MONTHS = ['2026-11'];

(async () => {
  const { openPool, loadEnv } = await import('./lib/db.mjs');
  loadEnv();
  const { pool, target } = openPool();
  console.log(`Banco de destino: ${target}`);
  const { calculatePayroll } = require('../lib/payroll-utils.ts');

  try {
    const org = (await pool.query(`SELECT id, name, is_test FROM organizations WHERE slug = 'kappa' AND deleted_at IS NULL`)).rows[0];
    if (!org || !org.is_test) throw new Error('Organização kappa não encontrada ou não é conta de teste — parando.');
    const technicians = (await pool.query(
      `SELECT id, name FROM technicians WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY name`,
      [org.id],
    )).rows;
    const admin = (await pool.query(`SELECT id FROM users WHERE organization_id = $1 AND role = 'admin' AND deleted_at IS NULL ORDER BY (email LIKE 'carla%') DESC LIMIT 1`, [org.id])).rows[0];

    const summary = [];
    const netByMonth = new Map();
    for (const [status, months] of [['closed', CLOSED_MONTHS], ['draft', DRAFT_MONTHS]]) {
      for (const month of months) {
        for (const t of technicians) {
          const p = await calculatePayroll({ organizationId: org.id, technicianId: t.id, competenceMonth: month });
          await pool.query(
            `INSERT INTO payroll (organization_id, technician_id, competence_month, total_services_value, commission_value, base_salary, va_deduction, vr_deduction,
                                  discounts_total, advances_total, extra_hours_value, extraordinary_award_value, hour_bank_balance, net_total, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (technician_id, competence_month) DO UPDATE
             SET total_services_value = EXCLUDED.total_services_value, commission_value = EXCLUDED.commission_value, base_salary = EXCLUDED.base_salary,
                 va_deduction = EXCLUDED.va_deduction, vr_deduction = EXCLUDED.vr_deduction, discounts_total = EXCLUDED.discounts_total,
                 advances_total = EXCLUDED.advances_total, extra_hours_value = EXCLUDED.extra_hours_value, extraordinary_award_value = EXCLUDED.extraordinary_award_value,
                 hour_bank_balance = EXCLUDED.hour_bank_balance, net_total = EXCLUDED.net_total, status = EXCLUDED.status,
                 deleted_at = NULL, deleted_by = NULL, updated_at = NOW()`,
            [org.id, p.technician_id, p.competence_month, p.total_services_value, p.commission_value, p.base_salary, p.va_deduction, p.vr_deduction,
              p.discounts_total, p.advances_total, p.extra_hours_value, p.extraordinary_award_value, p.hour_bank_balance, p.net_total, status],
          );
          netByMonth.set(month, (netByMonth.get(month) ?? 0) + Number(p.net_total));
          summary.push({ mês: month, técnico: t.name, status, serviços: p.total_services_value, comissão: p.commission_value, extras: p.extra_hours_value, descontos: p.discounts_total, adiantamentos: p.advances_total, líquido: p.net_total });
        }
      }
    }
    console.table(summary);

    // "Folha" bills: closed months are paid on the 5th of the following month.
    const existing = (await pool.query(`SELECT COUNT(*)::int AS n FROM financial_entries WHERE organization_id = $1 AND category = 'Folha' AND deleted_at IS NULL`, [org.id])).rows[0].n;
    if (existing === 0) {
      for (const month of CLOSED_MONTHS) {
        const [y, m] = month.split('-').map(Number);
        const next = new Date(Date.UTC(y, m, 1));
        const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
        const due = `${nextMonth}-05`;
        const amount = Math.round(netByMonth.get(month) * 100) / 100;
        const paid = due <= TODAY;
        const id = randomUUID();
        await pool.query(
          `INSERT INTO financial_entries (id, organization_id, type, description, category, supplier, amount, due_date, competence_month, status, paid_amount, paid_at, payment_method, nature, is_recurring)
           VALUES ($1, $2, 'payable', $3, 'Folha', 'Equipe técnica', $4, $5, $6, $7, $8, $9, 'transfer', 'fixed', false)`,
          [id, org.id, `Folha de pagamento — técnicos (${month.slice(5)}/${month.slice(0, 4)})`, amount, due, month, paid ? 'paid' : 'pending', paid ? amount : 0, paid ? due : null],
        );
        if (paid) {
          await pool.query(
            `INSERT INTO financial_payments (organization_id, entry_id, amount, paid_at, method, created_by) VALUES ($1, $2, $3, $4, 'transfer', $5)`,
            [org.id, id, amount, due, admin.id],
          );
        }
      }
      console.log('Despesas: contas de folha lançadas (ago a out).');
    } else {
      // Re-run after the hours or discounts changed: bring the existing bills (and their payments) to the new totals.
      for (const month of CLOSED_MONTHS) {
        const amount = Math.round(netByMonth.get(month) * 100) / 100;
        const description = `Folha de pagamento — técnicos (${month.slice(5)}/${month.slice(0, 4)})`;
        const updated = (await pool.query(
          `UPDATE financial_entries SET amount = $3, paid_amount = CASE WHEN status = 'paid' THEN $3 ELSE paid_amount END, updated_at = NOW()
           WHERE organization_id = $1 AND category = 'Folha' AND description = $2 AND deleted_at IS NULL RETURNING id, status`,
          [org.id, description, amount],
        )).rows;
        for (const row of updated) {
          if (row.status === 'paid') await pool.query(`UPDATE financial_payments SET amount = $2 WHERE entry_id = $1 AND deleted_at IS NULL`, [row.id, amount]);
        }
      }
      console.log('Despesas: contas de folha atualizadas para os novos totais.');
    }
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error('Falhou:', error);
  process.exitCode = 1;
});
