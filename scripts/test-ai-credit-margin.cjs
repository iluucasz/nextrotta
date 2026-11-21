// Run with: node scripts/test-ai-credit-margin.cjs
// The price of an AI credit package: the owner's margin is what is left AFTER the provider's cost and Asaas's fee.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

for (const name of ['.env.local', '.env']) {
  const file = path.join(__dirname, '..', name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
process.env.DATABASE_URL ||= 'postgres://user:pass@localhost/none';
require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
const { asaasFee, priceForMargin } = require('../lib/platform/ai-credits.ts');
const { DEFAULT_PLATFORM_SETTINGS } = require('../lib/platform/settings.ts');

const pricing = (over = {}) => {
  const base = { costPerCredit: 0.01, targetMarginPercent: 50, asaasFeeFixed: 1.99, asaasFeePercent: 0, ...over };
  base.keepShare = 1 - base.targetMarginPercent / 100 - base.asaasFeePercent / 100;
  base.minPricePerCredit = base.costPerCredit / base.keepShare;
  return base;
};
const margin = (price, credits, p) => ((price - credits * p.costPerCredit - asaasFee(price, p)) / price) * 100;

test('Asaas keeps a fixed amount plus a percentage of every paid charge', () => {
  assert.equal(asaasFee(100, { asaasFeeFixed: 1.99, asaasFeePercent: 0 }), 1.99);
  assert.equal(asaasFee(100, { asaasFeeFixed: 0.49, asaasFeePercent: 2.99 }), 0.49 + 2.99);
  assert.equal(asaasFee(0, { asaasFeeFixed: 1.99, asaasFeePercent: 0 }), 0, 'nothing charged, nothing kept');
});

test('the package price leaves the target margin after the provider and the Asaas fee', () => {
  const p = pricing();
  // (1000 × 0,01 + 1,99) ÷ 0,5 = 23,98 -> 24,00 (rounded up to R$ 0,50)
  assert.equal(priceForMargin(1000, p), 24);
  assert.ok(margin(24, 1000, p) >= 50, `margin ${margin(24, 1000, p)}`);
  // Ignoring the fee would have undershot it: 20,00 only leaves ~40%
  assert.ok(margin(20, 1000, p) < 50);
  // a bigger package spreads the fixed fee over more credits
  const small = priceForMargin(100, p);
  assert.ok(margin(small, 100, p) >= 50);
  assert.ok(priceForMargin(5000, p) / 5000 < priceForMargin(500, p) / 500);
});

test('a percentage fee (card) raises the price further', () => {
  const pix = pricing();
  const card = pricing({ asaasFeePercent: 3 });
  const priceCard = priceForMargin(1000, card);
  assert.ok(priceCard > priceForMargin(1000, pix));
  assert.ok(margin(priceCard, 1000, card) >= 50);
});

test('without a possible margin there is no price to suggest', () => {
  assert.equal(priceForMargin(1000, pricing({ targetMarginPercent: 80, asaasFeePercent: 20 })), null, 'margin + fee % of 100% leaves nothing');
});

test('the Asaas fee has a default (Pix/boleto) and the settings keep it', () => {
  assert.equal(DEFAULT_PLATFORM_SETTINGS.ai.asaasFeeFixed, 1.99);
  assert.equal(DEFAULT_PLATFORM_SETTINGS.ai.asaasFeePercent, 0);
});
