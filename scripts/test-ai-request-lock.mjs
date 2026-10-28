// Checks the SQL behind the assistant's "one question at a time" lock (lib/ai/assistant.ts):
// two simultaneous takers on the same organization → exactly one wins; after the release the next
// one wins; a lock past its time can be taken over. Uses the first organization of the target
// database and leaves its lock released.
import assert from 'node:assert/strict';
import { openPool } from './lib/db.mjs';

const { pool, target } = openPool();
console.log(`Banco de destino: ${target}`);

const take = (organizationId, seconds = 130) =>
  pool.query(
    `INSERT INTO ai_request_locks (organization_id, locked_until)
     VALUES ($1, NOW() + $2::int * INTERVAL '1 second')
     ON CONFLICT (organization_id) DO UPDATE SET locked_until = EXCLUDED.locked_until
     WHERE ai_request_locks.locked_until <= NOW()
     RETURNING organization_id`,
    [organizationId, seconds],
  );
const release = (organizationId) =>
  pool.query('UPDATE ai_request_locks SET locked_until = NOW() WHERE organization_id = $1', [organizationId]);

try {
  const { rows } = await pool.query('SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1');
  assert.ok(rows[0], 'nenhuma organização no banco');
  const organizationId = rows[0].id;
  await release(organizationId).catch(() => {});

  const winners = (await Promise.all(Array.from({ length: 5 }, () => take(organizationId)))).filter((result) => result.rowCount === 1);
  assert.equal(winners.length, 1, 'só um pedido simultâneo pode ficar com o bloqueio');
  assert.equal((await take(organizationId)).rowCount, 0, 'enquanto está tomado, ninguém mais entra');

  await release(organizationId);
  assert.equal((await take(organizationId, 1)).rowCount, 1, 'depois de liberado, o próximo entra');

  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await take(organizationId)).rowCount, 1, 'um bloqueio vencido pode ser retomado');

  await release(organizationId);
  console.log('ok: bloqueio de pergunta do assistente');
} finally {
  await pool.end();
}
