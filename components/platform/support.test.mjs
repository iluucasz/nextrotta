import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  });
  return exports;
}
const errors = load('lib/platform/errors.ts');
const reports = load('lib/reports.ts');
const id = '00000000-0000-4000-8000-000000000001';
const actor = { id };
const now = '2026-10-03T12:00:00Z';

function newsHarness(override = {}) {
  let row = {
    id,
    title: 'Novidade',
    body: 'Um novo recurso disponível.',
    published_on: '2026-10-03',
    category: 'improvement',
    destination: 'both',
    status: 'draft',
    image_url: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    ...override,
  };
  const events = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?').trim();
    if (query.startsWith('SELECT')) {
      if (query.includes("status = 'published'"))
        return row.status === 'published' &&
          !row.archived_at &&
          [values[0], 'both'].includes(row.destination)
          ? [structuredClone(row)]
          : [];
      return [structuredClone(row)];
    }
    if (query.includes('SET archived_at')) row.archived_at = values[0];
    else if (query.startsWith('UPDATE')) {
      const [
        title,
        published_on,
        category,
        body,
        image_url,
        destination,
        status,
      ] = values;
      Object.assign(row, {
        title,
        published_on,
        category,
        body,
        image_url,
        destination,
        status,
      });
    } else throw Error(`Unexpected query ${query}`);
    return [];
  };
  return {
    api: load('lib/platform/news.ts', {
      '../db': { sql },
      '../audit': { recordAudit: async (event) => events.push(event) },
      './errors': errors,
    }),
    events,
  };
}

test('a draft publishes with a status-only PATCH, preserving its content and destinations', async () => {
  const h = newsHarness();
  assert.deepEqual(await h.api.listPublishedNews('site'), []);
  const published = await h.api.updateNewsPost(
    id,
    { status: 'published' },
    actor,
  );
  assert.equal(published.status, 'published');
  assert.equal(published.title, 'Novidade');
  assert.equal(published.body, 'Um novo recurso disponível.');
  assert.equal(published.destination, 'both');
  assert.equal((await h.api.listPublishedNews('site')).length, 1);
  assert.equal((await h.api.listPublishedNews('system')).length, 1);
  assert.equal(h.events[0].action, 'news.published');
});

test('publication validates body and does not expose archived or wrong-destination posts', async () => {
  const empty = newsHarness({ body: '' });
  await assert.rejects(
    empty.api.updateNewsPost(id, { status: 'published' }, actor),
    /Escreva o texto/,
  );
  assert.equal((await empty.api.getNewsPost(id)).status, 'draft');
  const archived = newsHarness({ archived_at: now });
  await assert.rejects(
    archived.api.updateNewsPost(id, { status: 'published' }, actor),
    /Restaure/,
  );
  const system = newsHarness({ destination: 'system' });
  await system.api.updateNewsPost(id, { status: 'published' }, actor);
  assert.deepEqual(await system.api.listPublishedNews('site'), []);
  assert.equal((await system.api.listPublishedNews('system')).length, 1);
  await system.api.updateNewsPost(id, { archived: true }, actor);
  assert.deepEqual(await system.api.listPublishedNews('system'), []);
});

function reportsHarness({ missingColumn = false } = {}) {
  const rows = [];
  const messages = [
    {
      id: 'm1',
      author_name: 'Equipe',
      from_owner: true,
      internal: false,
      text: 'Recebido',
      created_at: now,
    },
    {
      id: 'm2',
      author_name: 'Equipe',
      from_owner: true,
      internal: true,
      text: 'Nota interna',
      created_at: now,
    },
  ];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    if (query.includes('INSERT INTO bug_reports')) {
      const suggestion = query.includes('report_type');
      if (suggestion && missingColumn)
        throw Object.assign(new Error('undefined column'), { code: '42703' });
      const [
        organization_id,
        user_id,
        title,
        description,
        page_url,
        user_agent,
        app_version,
        screenshot,
      ] = values;
      rows.push({
        id,
        organization_id,
        user_id,
        title,
        description,
        page_url,
        user_agent,
        app_version,
        screenshot,
        report_type: suggestion ? 'suggestion' : 'bug',
        status: 'new',
        priority: 'medium',
        created_at: now,
        updated_at: now,
      });
      return [{ id }];
    }
    if (query.includes('SELECT m.*'))
      return messages.filter((message) => values[1] || !message.internal);
    throw Error(`Unexpected query ${query}`);
  };
  sql.query = async (query, values) => {
    if (query.includes('WHERE b.id = $1'))
      return rows.filter((row) => row.id === values[0]);
    let filtered = rows;
    if (query.includes('b.organization_id = $1'))
      filtered = filtered.filter((row) => row.organization_id === values[0]);
    if (query.includes('b.user_id = $2'))
      filtered = filtered.filter((row) => row.user_id === values[1]);
    return filtered;
  };
  const api = load('lib/platform/bugs.ts', {
    '../db': { sql },
    '../audit': { recordAudit: async () => {} },
    './errors': errors,
    '../reports': reports,
  });
  return { api, rows };
}

const input = {
  title: 'Resumo semanal',
  description: 'Gostaria de receber um resumo da minha operação.',
};
const reporter = { organizationId: 'org-a', userId: 'user-a' };
test('bug and suggestion types persist and appear correctly in the owner and customer inbox', async () => {
  for (const type of ['bug', 'suggestion']) {
    const h = reportsHarness();
    await h.api.createBugReport(reporter, {
      ...input,
      type,
      organizationId: 'forged-org',
    });
    const inbox = await h.api.listBugReports();
    assert.equal(inbox[0].type, type);
    assert.equal(inbox[0].organizationId, 'org-a');
    assert.equal(
      (
        await h.api.listBugReports({
          organizationId: 'org-a',
          userId: 'user-a',
        })
      ).length,
      1,
    );
    assert.equal(
      (await h.api.listBugReports({ organizationId: 'org-b' })).length,
      0,
    );
    const detail = await h.api.getBugReport(id, {
      kind: 'organization',
      organizationId: 'org-a',
    });
    assert.equal(detail.report.type, type);
    assert.equal(detail.messages.length, 1);
    assert.equal(
      (await h.api.getBugReport(id, { kind: 'owner' })).messages.length,
      2,
    );
    await assert.rejects(
      h.api.getBugReport(id, { kind: 'organization', organizationId: 'org-b' }),
      (error) => error.status === 404,
    );
  }
});

test('legacy reports remain bugs and unknown types are rejected', async () => {
  const h = reportsHarness();
  await h.api.createBugReport(reporter, input);
  delete h.rows[0].report_type;
  assert.equal((await h.api.listBugReports())[0].type, 'bug');
  await assert.rejects(
    h.api.createBugReport(reporter, { ...input, type: 'other' }),
    /Bug ou Sugestão/,
  );
  assert.equal(h.rows.length, 1);
});

test('bugs remain available before migration and suggestions fail with an actionable error', async () => {
  const h = reportsHarness({ missingColumn: true });
  await h.api.createBugReport(reporter, input);
  await assert.rejects(
    h.api.createBugReport(reporter, { ...input, type: 'suggestion' }),
    (error) => error.status === 503,
  );
  assert.equal(h.rows.length, 1);
});
