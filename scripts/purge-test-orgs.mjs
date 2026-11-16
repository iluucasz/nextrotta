// Permanently removes the zz-* test organizations (and everything scoped to them) from the development DB.
// Run purge-test-blobs.mjs FIRST (it needs the rows to find the files). Usage: node scripts/purge-test-orgs.mjs [--apply]
const { openPool } = await import('./lib/db.mjs');
const apply = process.argv.includes('--apply');
const { pool, target } = openPool();
console.log('target:', target, apply ? '(APPLY)' : '(dry run)');

const lastError = {};
const client = await pool.connect();
try {
  const orgs = await client.query(`SELECT id, slug FROM organizations WHERE slug LIKE 'zz-%'`);
  const ids = orgs.rows.map((row) => row.id);
  console.log('orgs to remove:', ids.length);
  if (!ids.length) process.exit(0);

  const tables = (
    await client.query(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' ORDER BY 1`)
  ).rows.map((row) => row.table_name);

  await client.query('BEGIN');
  const containers = (await client.query(`SELECT DISTINCT storage_container_id AS id FROM organizations WHERE id = ANY($1::uuid[]) AND storage_container_id IS NOT NULL`, [ids])).rows.map((row) => row.id);
  // Tables without organization_id that hang from rows scoped to the test organizations.
  const children = [
    ['bug_events', 'bug_id', 'bug_reports'],
    ['bug_messages', 'bug_id', 'bug_reports'],
    ['lead_notes', 'lead_id', 'leads'],
    ['livechat_messages', 'conversation_id', 'livechat_conversations'],
    ['notification_reads', 'notification_id', 'notifications'],
    ['platform_notice_reads', 'notice_id', 'platform_notices'],
  ];
  const deleted0 = {};
  deleted0.livechat_attachments = (await client.query('DELETE FROM livechat_attachments WHERE organization_id = ANY($1::uuid[])', [ids])).rowCount;
  for (const [table, column, parent] of children) {
    const result = await client.query(`DELETE FROM "${table}" WHERE "${column}" IN (SELECT id FROM "${parent}" WHERE organization_id = ANY($1::uuid[]))`, [ids]);
    deleted0[table] = result.rowCount;
  }
  const deleted = { ...deleted0 };
  let pending = [...tables];
  for (let round = 0; round < 12 && pending.length; round++) {
    const next = [];
    for (const table of pending) {
      await client.query('SAVEPOINT s');
      try {
        const result = await client.query(`DELETE FROM "${table}" WHERE organization_id = ANY($1::uuid[])`, [ids]);
        deleted[table] = (deleted[table] || 0) + result.rowCount;
        await client.query('RELEASE SAVEPOINT s');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT s');
        if (error.code === '23503') { next.push(table); lastError[table] = error.detail || error.message; }
        else throw new Error(`${table}: ${error.message}`);
      }
    }
    pending = next;
  }
  if (pending.length) throw new Error('could not clear: ' + pending.map((t) => t + ' => ' + lastError[t]).join(' | '));

  const result = await client.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ids]);
  deleted.organizations = result.rowCount;
  if (containers.length) {
    const left = await client.query(`DELETE FROM storage_containers WHERE id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.storage_container_id = storage_containers.id)`, [containers]);
    deleted.storage_containers = left.rowCount;
  }
  console.table(Object.entries(deleted).filter(([, count]) => count > 0).map(([table, count]) => ({ table, count })));

  const left = await client.query(`SELECT slug FROM organizations ORDER BY slug`);
  console.log('organizations left:', left.rows.map((row) => row.slug).join(', '));

  if (apply) {
    await client.query('COMMIT');
    console.log('COMMITTED');
  } else {
    await client.query('ROLLBACK');
    console.log('rolled back (dry run)');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('FAILED:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
