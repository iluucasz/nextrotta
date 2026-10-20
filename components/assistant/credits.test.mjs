import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('credit usage is tenant-scoped and aggregated independently of the limited statement', async () => {
  const queries = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    queries.push(query);
    assert.deepEqual(values, ['organization-a']);
    assert.match(query, /organization_id = \?/);
    if (query.includes('AS balance')) return [{ balance: '120' }];
    if (query.includes('GROUP BY')) {
      assert.match(query, /kind = 'consumption'/);
      assert.match(query, /America\/Sao_Paulo/);
      assert.doesNotMatch(query, /LIMIT/);
      return [{ month: '2026-10', credits: '350', uses: '350' }];
    }
    if (query.includes('subscriptions'))
      return [{ ai_monthly_credits: '500', has_ai: true }];
    return [
      {
        id: 'ledger-1',
        kind: 'consumption',
        quantity: -1,
        cost: null,
        created_at: '2026-10-03T12:00:00Z',
      },
    ];
  };
  const code = ts.transpileModule(
    readFileSync('lib/platform/ai-credits.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    if (name === '../db') return { sql };
    if (
      ['../audit', '../billing/billing', './errors', './settings'].includes(
        name,
      )
    )
      return {};
    throw Error(`Unexpected dependency: ${name}`);
  });
  const result = await exports.getOrganizationCredits('organization-a');
  assert.equal(queries.length, 4);
  assert.equal(result.balance, 120);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.usage, [
    { month: '2026-10', credits: 350, uses: 350 },
  ]);
});
