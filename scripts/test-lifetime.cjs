// Run with: node scripts/test-lifetime.cjs   (uses the database in .env: creates one throwaway organization and archives it at the end)
// Lifetime organizations ("vitalício") use the platform without paying: out of MRR, charges and the
// delinquency flow, but their consumption still counts as cost.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { neon } = require('@neondatabase/serverless');
const { getOverview, parsePeriod, listAllCharges } = require('../lib/platform/overview.ts');
const { getCostAllocation } = require('../lib/platform/costs.ts');
const { setLifetime } = require('../lib/platform/organizations.ts');
const { evaluateBillingStatus, runBillingMaintenance, activateBilling } = require('../lib/billing/billing.ts');
const { listUpgradeOptions } = require('../lib/billing/upgrade.ts');

const COST_MONTH = '2099-01';

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  console.log('banco:', new URL(process.env.DATABASE_URL).hostname);
  const [owner] = await sql`SELECT id FROM users WHERE role = 'platform_owner' ORDER BY created_at LIMIT 1`;
  const OWNER = { id: String(owner.id) };
  const slug = `zz-vitalicio-${Date.now().toString(36)}`;
  const [{ id: planId }] = await sql`SELECT id FROM plans WHERE key = 'essencial'`;
  const [{ id: orgId }] = await sql`INSERT INTO organizations (slug, name, status, activated_at) VALUES (${slug}, 'Teste vitalício', 'active', NOW()) RETURNING id`;
  await sql`
    INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, extra_technician_price, included_technicians)
    VALUES (${orgId}, ${planId}, 'monthly', 217, 0, 5)
  `;
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, value, due_date, status, paid_at)
    VALUES (${orgId}, ${`pay_${slug}`}, 'subscription', 100, ${today}::date, 'RECEIVED', NOW())
  `;
  await sql`
    INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, value, due_date, status)
    VALUES (${orgId}, ${`pay_late_${slug}`}, 'subscription', 50, ${today}::date - 30, 'OVERDUE')
  `;
  const [{ id: costId }] = await sql`INSERT INTO infra_costs (month, category, amount) VALUES (${COST_MONTH}, 'other', 100) RETURNING id`;
  const period = parsePeriod(null, null);

  try {
    // 1. Paying organization: counted everywhere.
    const before = await getOverview(period);
    const costsBefore = await getCostAllocation(COST_MONTH);
    const lineBefore = costsBefore.organizations.find((row) => row.organizationId === orgId);
    assert.equal(lineBefore.monthlyRevenue, 217, 'receita mensal da empresa que paga');
    assert.ok((await listAllCharges(period)).some((row) => row.organizationId === orgId), 'cobranças da empresa aparecem');

    // 2. Needs a reason; a second call is refused.
    await assert.rejects(setLifetime(orgId, { enabled: true }, OWNER), /motivo/i);
    const organization = await setLifetime(orgId, { enabled: true, reason: 'Parceiro (teste)' }, OWNER);
    assert.equal(organization.lifetime, true);
    assert.equal(organization.lifetimeReason, 'Parceiro (teste)');
    await assert.rejects(setLifetime(orgId, { enabled: true, reason: 'de novo' }, OWNER), /já é vitalícia/);

    // 3. Revenue: out of MRR, charges, overdue, history and forecast.
    const after = await getOverview(period);
    assert.equal(Math.round((before.mrr - after.mrr) * 100) / 100, 217, 'MRR perde exatamente o valor da empresa');
    assert.equal(after.lifetimeOrganizations, before.lifetimeOrganizations + 1);
    assert.equal(Math.round((before.overdue.value - after.overdue.value) * 100) / 100, 50, 'atraso dela sai do total');
    const received = (view) => Object.values(view.revenueByKind).reduce((sum, value) => sum + value, 0);
    assert.equal(Math.round((received(before) - received(after)) * 100) / 100, 100, 'receita recebida dela sai');
    assert.ok(!(await listAllCharges(period)).some((row) => row.organizationId === orgId), 'cobranças dela saem da lista financeira');

    // 4. Costs: still takes its part of the platform's costs, with no revenue (the margin is its cost).
    const costsAfter = await getCostAllocation(COST_MONTH);
    const line = costsAfter.organizations.find((row) => row.organizationId === orgId);
    assert.equal(line.lifetime, true);
    assert.ok(line.estimatedCost > 0, 'o gasto dela continua contado');
    assert.equal(line.estimatedCost, lineBefore.estimatedCost, 'o gasto não muda ao virar vitalícia');
    assert.equal(line.monthlyRevenue, 0);
    assert.equal(line.margin, -line.estimatedCost);
    assert.equal(Math.round((costsBefore.totalRevenue - costsAfter.totalRevenue) * 100) / 100, 217, 'receita total dos gastos perde a dela');

    // 4b. The platform's own AI/usage numbers stay (cost is untouched by the flag).
    assert.equal(costsAfter.totalCost, costsBefore.totalCost);

    // 5. Billing: never past due, never suspended, never charged.
    await evaluateBillingStatus(orgId);
    await sql`UPDATE organizations SET status = 'past_due' WHERE id = ${orgId}`;
    await runBillingMaintenance();
    const [stillPastDue] = await sql`SELECT status FROM organizations WHERE id = ${orgId}`;
    assert.equal(stillPastDue.status, 'past_due', 'a manutenção de cobrança não suspende vitalícia');
    await sql`UPDATE organizations SET status = 'active' WHERE id = ${orgId}`;
    await evaluateBillingStatus(orgId);
    const [stillActive] = await sql`SELECT status FROM organizations WHERE id = ${orgId}`;
    assert.equal(stillActive.status, 'active', 'cobrança vencida não deixa vitalícia em atraso');
    await assert.rejects(activateBilling(orgId, {}, OWNER), /vitalícia/);

    // 6. No upgrade through the company's own screen.
    const upgrade = await listUpgradeOptions(orgId);
    assert.equal(upgrade.available, false);
    assert.deepEqual(upgrade.options, []);

    // 7. A gateway-billed organization needs the owner's confirmation before becoming lifetime.
    await setLifetime(orgId, { enabled: false }, OWNER);
    await sql`UPDATE subscriptions SET asaas_subscription_id = 'sub_fake' WHERE organization_id = ${orgId}`;
    await assert.rejects(setLifetime(orgId, { enabled: true, reason: 'sem confirmar' }, OWNER), /cobrança recorrente ativa/);
    await sql`UPDATE subscriptions SET asaas_subscription_id = NULL WHERE organization_id = ${orgId}`;

    // 8. A hold put by billing is lifted when it becomes lifetime; a hold from the owner stays.
    await sql`UPDATE organizations SET status = 'suspended', status_source = 'billing', status_reason = 'Inadimplência' WHERE id = ${orgId}`;
    await setLifetime(orgId, { enabled: true, reason: 'Parceiro (teste)' }, OWNER);
    const [released] = await sql`SELECT status FROM organizations WHERE id = ${orgId}`;
    assert.equal(released.status, 'active');
    await setLifetime(orgId, { enabled: false }, OWNER);
    await sql`UPDATE organizations SET status = 'suspended', status_source = 'owner', status_reason = 'Pedido do dono' WHERE id = ${orgId}`;
    await setLifetime(orgId, { enabled: true, reason: 'Parceiro (teste)' }, OWNER);
    const [kept] = await sql`SELECT status FROM organizations WHERE id = ${orgId}`;
    assert.equal(kept.status, 'suspended', 'suspensão do dono não é desfeita');

    // 9. Turning it off brings the revenue back.
    await sql`UPDATE organizations SET status = 'active', status_source = 'owner' WHERE id = ${orgId}`;
    const off = await setLifetime(orgId, { enabled: false }, OWNER);
    assert.equal(off.lifetime, false);
    const back = await getOverview(period);
    assert.equal(Math.round((back.mrr - before.mrr) * 100) / 100, 0);
    await assert.rejects(setLifetime(orgId, { enabled: false }, OWNER), /não é vitalícia/);

    console.log('ok: modo vitalício fora da receita e da cobrança, dentro dos custos');
  } finally {
    // Nothing is deleted: the throwaway organization and cost are archived.
    await sql`UPDATE infra_costs SET deleted_at = NOW() WHERE id = ${costId}`;
    await sql`UPDATE organizations SET deleted_at = NOW(), status = 'canceled', lifetime = FALSE WHERE id = ${orgId}`;
    await sql`UPDATE billing_charges SET status = 'CANCELED' WHERE organization_id = ${orgId}`;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
