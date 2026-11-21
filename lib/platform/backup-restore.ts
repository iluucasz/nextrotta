import type { ParsedPlatformBackup } from './backup-format';

// Puts a platform backup back into a database. Used by scripts/restore-platform-backup.cjs (a disaster) and by the test that
// proves the copies can be restored. Never imported by the app or the worker. Nothing here deletes: it only fills EMPTY tables.
//
// Foreign keys can't be switched off without superuser, so the tables go in dependency order. Where tables point at each other
// in a circle (users <-> organizations <-> storage_containers, parts <-> part_images), one nullable column of the circle is
// inserted empty and filled in afterwards.

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const BATCH = 500;

type ForeignKey = { table: string; references: string; columns: string[]; nullable: boolean };

export type RestorePlan = {
  order: string[];
  /** Columns left empty on the first pass (and filled later), by table. */
  deferred: Map<string, Set<string>>;
};

/** The order the tables can be filled in, and the columns to leave for later when tables point at each other. Pure. */
export function planRestore(tables: string[], foreignKeys: ForeignKey[]): RestorePlan {
  const wanted = new Set(tables);
  // Self references are fine: a single INSERT checks its constraints at the end of the statement.
  const edges = foreignKeys.filter((fk) => wanted.has(fk.table) && wanted.has(fk.references) && fk.table !== fk.references);
  const deferred = new Map<string, Set<string>>();
  const cut = new Set<ForeignKey>();
  const order: string[] = [];
  const placed = new Set<string>();

  while (placed.size < tables.length) {
    const ready = tables.filter(
      (table) =>
        !placed.has(table) &&
        edges.every((fk) => fk.table !== table || cut.has(fk) || placed.has(fk.references)),
    );
    if (ready.length) {
      for (const table of ready) {
        order.push(table);
        placed.add(table);
      }
      continue;
    }
    // Every table left waits for another: cut one nullable reference that lies ON a circle (a table that merely waits for a
    // parent is not touched: leaving its column empty for a while could even break a unique index).
    const open = edges.filter((fk) => !cut.has(fk) && !placed.has(fk.table) && !placed.has(fk.references));
    const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return open.some((fk) => fk.table === from && reaches(fk.references, to, seen));
    };
    const candidate = open.find((fk) => fk.nullable && reaches(fk.references, fk.table));
    if (!candidate) {
      throw new Error(`Não dá para ordenar a restauração: as tabelas ${tables.filter((t) => !placed.has(t)).join(', ')} dependem umas das outras sem coluna opcional.`);
    }
    cut.add(candidate);
    const columns = deferred.get(candidate.table) ?? new Set<string>();
    candidate.columns.forEach((column) => columns.add(column));
    deferred.set(candidate.table, columns);
  }
  return { order, deferred };
}

async function loadForeignKeys(db: Queryable, schema: string): Promise<ForeignKey[]> {
  const result = await db.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.confrelid::regclass::text AS references_name,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
            -- Only a column that may be empty AND that no CHECK constraint looks at can be filled in later.
            ((SELECT bool_and(NOT a.attnotnull) FROM unnest(c.conkey) AS k(attnum)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
              AND NOT EXISTS (SELECT 1 FROM pg_constraint ck WHERE ck.conrelid = c.conrelid AND ck.contype = 'c' AND ck.conkey && c.conkey)
              -- nor one that a unique index (other than the primary key) looks at: empty for a while it would collide
              AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                WHERE i.indrelid = c.conrelid AND i.indisunique AND NOT i.indisprimary
                  AND pg_get_indexdef(i.indexrelid) ~* ('\m(' || (SELECT string_agg(a.attname::text, '|') FROM unnest(c.conkey) AS k(attnum)
                       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) || ')\M')
              )) AS nullable
     FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = $1::regnamespace`,
    [schema],
  );
  const bare = (name: unknown) => String(name).replace(/^"?[^".]+"?\./, '').replace(/^"|"$/g, '');
  return result.rows.map((row) => ({
    table: bare(row.table_name),
    references: bare(row.references_name),
    columns: row.columns as string[],
    nullable: Boolean(row.nullable),
  }));
}

export type RestoreResult = { inserted: Record<string, number>; skippedTables: string[] };

/**
 * Fills the (empty) tables of `schema` with the backup. The caller owns the transaction (BEGIN/COMMIT), so a failure leaves
 * nothing behind. Tables the backup has but the database doesn't are reported in skippedTables; a table that isn't empty stops it.
 */
export async function restorePlatformBackup(db: Queryable, schema: string, backup: ParsedPlatformBackup): Promise<RestoreResult> {
  const existing = new Set(
    (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema])).rows.map((row) => String(row.table_name)),
  );
  const tables = backup.header.tables.filter((table) => existing.has(table));
  const skippedTables = backup.header.tables.filter((table) => !existing.has(table));

  for (const table of tables) {
    const filled = await db.query(`SELECT EXISTS (SELECT 1 FROM ${quote(schema)}.${quote(table)} LIMIT 1) AS filled`);
    // schema_migrations is filled by `pnpm db:migrate`; the rest must be empty.
    if (filled.rows[0].filled && table !== 'schema_migrations') throw new Error(`A tabela ${table} já tem dados. A restauração só preenche um banco vazio.`);
  }

  const plan = planRestore(tables, await loadForeignKeys(db, schema));
  const inserted: Record<string, number> = {};

  for (const table of plan.order) {
    const rows = backup.rows.get(table) ?? [];
    inserted[table] = rows.length;
    if (!rows.length) continue;
    const qualified = `${quote(schema)}.${quote(table)}`;
    const columns = (
      await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
        [schema, table],
      )
    ).rows.map((row) => String(row.column_name));
    const left = plan.deferred.get(table);
    const first = columns.filter((column) => !left?.has(column));
    const list = first.map(quote).join(', ');
    for (let start = 0; start < rows.length; start += BATCH) {
      const payload = `[${rows.slice(start, start + BATCH).join(',')}]`;
      // Columns left for the second pass simply aren't listed. schema_migrations already has the rows `db:migrate` wrote.
      await db.query(
        `INSERT INTO ${qualified} (${list}) OVERRIDING SYSTEM VALUE
         SELECT ${list} FROM jsonb_populate_recordset(NULL::${qualified}, $1::jsonb) AS r${table === 'schema_migrations' ? ' ON CONFLICT DO NOTHING' : ''}`,
        [payload],
      );
    }
  }

  // Second pass: the columns left empty because of a circle.
  for (const [table, left] of plan.deferred) {
    const rows = backup.rows.get(table) ?? [];
    if (!rows.length) continue;
    const qualified = `${quote(schema)}.${quote(table)}`;
    const key = (
      await db.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
        [qualified],
      )
    ).rows.map((row) => String(row.attname));
    if (!key.length) throw new Error(`A tabela ${table} não tem chave primária para completar a restauração.`);
    const sets = [...left].map((column) => `${quote(column)} = r.${quote(column)}`).join(', ');
    const match = key.map((column) => `t.${quote(column)} = r.${quote(column)}`).join(' AND ');
    for (let start = 0; start < rows.length; start += BATCH) {
      await db.query(
        `UPDATE ${qualified} t SET ${sets} FROM jsonb_populate_recordset(NULL::${qualified}, $1::jsonb) AS r WHERE ${match}`,
        [`[${rows.slice(start, start + BATCH).join(',')}]`],
      );
    }
  }

  // Counters of serial/identity columns continue after the restored rows.
  for (const table of plan.order) {
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, table])).rows;
    for (const { column_name: column } of columns) {
      const sequence = (await db.query(`SELECT pg_get_serial_sequence($1, $2) AS sequence`, [`${quote(schema)}.${quote(table)}`, String(column)])).rows[0]?.sequence;
      if (!sequence) continue;
      await db.query(`SELECT setval($1, GREATEST(COALESCE((SELECT MAX(${quote(String(column))}) FROM ${quote(schema)}.${quote(table)}), 0), 1))`, [String(sequence)]);
    }
  }
  return { inserted, skippedTables };
}
