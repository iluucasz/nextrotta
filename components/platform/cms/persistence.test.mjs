import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual store with an isolated database adapter. Never import lib/db or read .env.
const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (id) => {
    if (id in dependencies) return dependencies[id];
    if (id === 'zod' || id === 'node:crypto') return require(id);
    throw Error(`Unexpected dependency: ${id}`);
  });
  return exports;
}
const content = load('lib/site/content.ts');
const errors = load('lib/platform/errors.ts');
const theme = load('components/site/theme.ts');
const actor = { id: '00000000-0000-4000-8000-000000000001' };
const copy = (value) => structuredClone(value);
function harness(initial = {}) {
  let row = {
    draft: null,
    published: null,
    draft_updated_at: null,
    published_at: null,
    ...copy(initial),
  };
  const events = [];
  let writes = 0;
  let beforeUpdate;
  const sql = async (parts, ...values) => {
    const query = parts.join('?').trim();
    if (query.startsWith('SELECT')) return [copy(row)];
    assert.match(query, /^UPDATE site_content/);
    assert.match(query, /draft IS NOT DISTINCT FROM/);
    assert.match(query, /published IS NOT DISTINCT FROM/);
    assert.match(query, /RETURNING \*/);
    beforeUpdate?.(row);
    const [
      draft,
      publish,
      published,
      publishDate,
      publishActor,
      actorId,
      expectedDraft,
      expectedPublished,
    ] = values;
    assert.equal(publish, publishDate);
    assert.equal(publish, publishActor);
    if (
      JSON.stringify(row.draft) !== JSON.stringify(JSON.parse(expectedDraft)) ||
      JSON.stringify(row.published) !==
        JSON.stringify(JSON.parse(expectedPublished))
    )
      return [];
    row.draft = JSON.parse(draft);
    row.draft_updated_at = new Date().toISOString();
    if (publish) {
      row.published = JSON.parse(published);
      row.published_at = new Date().toISOString();
      row.published_by = actorId;
    }
    writes++;
    return [copy(row)];
  };
  const store = load('lib/site/store.ts', {
    '../db': { sql },
    '../audit': { recordAudit: async (event) => events.push(event) },
    '../platform/errors': errors,
    './content': content,
  });
  return {
    store,
    events,
    row: () => copy(row),
    writes: () => writes,
    beforeUpdate: (fn) => {
      beforeUpdate = fn;
    },
  };
}
function document() {
  const doc = theme.normalizeDocument(copy(content.siteContent));
  for (const key of ['benefits', 'steps', 'security', 'testimonials', 'faq'])
    doc[key] = doc[key].map((item) => ({
      ...item,
      visible: item.visible !== false,
    }));
  doc.design.theme.primary = '#993366';
  doc.design.sections.reverse();
  doc.design.sections[0].hidden = true;
  doc.design.sections[1].archived = true;
  const section = theme.createSection('banner', 'campaign');
  section.settings = {
    title: 'Campanha',
    text: 'Texto independente',
    buttonLabel: 'Contato',
    buttonHref: '/contato',
    image: '/brand/example.png',
    background: '#112233',
    padding: 80,
    items: [{ id: 'one', title: 'Item', text: 'Detalhes', visible: false }],
  };
  doc.design.sections.push(section);
  doc.design.header = { ctaLabel: 'Vamos conversar', ctaHref: '/contato' };
  doc.design.footer = { tagline: 'Sua operação', signature: 'NextRotta' };
  return doc;
}

test('save and reload the complete draft without changing the public site', async () => {
  const h = harness();
  const doc = document();
  const saved = await h.store.saveSiteDraft(doc, actor);
  assert.deepEqual(saved.draft, doc);
  assert.equal(saved.designSupported, true);
  assert.equal(saved.hasUnpublishedChanges, true);
  assert.deepEqual(
    await h.store.getPublishedSiteContent(),
    content.siteContent,
  );
  assert.deepEqual((await h.store.getSiteEditorState()).draft, doc);
  assert.equal(saved.versions.length, 2);
  assert.equal(saved.versions[0].kind, 'draft');
  assert.equal(h.events[0].action, 'site.draft_saved');
});

test('publish the full theme, retain the previous publication, and restore as a draft', async () => {
  const old = { ...copy(content.siteContent), title: 'Site anterior' };
  const h = harness({ published: old, published_at: '2026-01-01T00:00:00Z' });
  const doc = document();
  const saved = await h.store.publishSite(doc, actor);
  assert.deepEqual(await h.store.getPublishedSiteContent(), doc);
  assert.equal(saved.hasUnpublishedChanges, false);
  assert.equal(h.row().published_by, actor.id);
  assert.ok(h.events[0].details.changedFields.includes('design'));
  const previous = saved.versions.find(
    (version) => version.content.title === 'Site anterior',
  );
  assert.ok(previous);
  const restored = await h.store.saveSiteDraft(previous.content, actor);
  // Old snapshots have no design, while the visual editor normalizes them before restoring.
  const restoredDoc = theme.normalizeDocument(previous.content);
  for (const key of ['benefits', 'steps', 'security', 'testimonials', 'faq'])
    restoredDoc[key] = restoredDoc[key].map((item) => ({
      ...item,
      visible: item.visible !== false,
    }));
  await h.store.saveSiteDraft(restoredDoc, actor);
  assert.equal(restored.draft.title, old.title);
  assert.deepEqual(await h.store.getPublishedSiteContent(), doc);
  const republished = await h.store.publishSite(restoredDoc, actor);
  assert.deepEqual(republished.published, restoredDoc);
  assert.equal(republished.hasUnpublishedChanges, false);
});

test('history stays bounded, private, and cannot be replaced by request metadata', async () => {
  const h = harness();
  const doc = document();
  for (let i = 0; i < 33; i++) {
    doc.title = `Version ${i}`;
    await h.store.saveSiteDraft(
      { ...doc, _cmsVersions: [{ id: 'forged' }] },
      actor,
    );
  }
  const state = await h.store.publishSite(doc, actor);
  assert.equal(state.versions.length, 30);
  assert.ok(
    state.versions.some(
      (v) =>
        v.kind === 'published' && v.content.title === content.siteContent.title,
    ),
    'Previous publication survives draft history rotation',
  );
  assert.ok(
    state.versions.every(
      (v) => v.id !== 'forged' && !('_cmsVersions' in v.content),
    ),
  );
  assert.ok(!('_cmsVersions' in state.draft));
  assert.ok(!('_cmsVersions' in (await h.store.getPublishedSiteContent())));
  const same = await h.store.saveSiteDraft(doc, actor);
  assert.equal(
    same.hasUnpublishedChanges,
    false,
    'History alone is not an unpublished change',
  );
});

test('legacy text-only saves preserve the theme already stored', async () => {
  const h = harness();
  const doc = document();
  await h.store.saveSiteDraft(doc, actor);
  const state = await h.store.saveSiteDraft(
    { ...content.siteContent, title: 'Texto atualizado' },
    actor,
  );
  assert.deepEqual(state.draft.design, doc.design);
});

test('invalid visual data is rejected before any write', async () => {
  const h = harness();
  const invalid = [
    (d) => {
      d.design.schemaVersion = 2;
    },
    (d) => {
      d.design.theme.primary = 'url(https://example.com)';
    },
    (d) => {
      d.design.theme.radius = -1;
    },
    (d) => {
      d.design.sections[0].type = 'script';
    },
    (d) => {
      d.design.sections.push(copy(d.design.sections[0]));
    },
    (d) => {
      d.design.sections[0].settings.buttonHref = 'javascript:alert(1)';
    },
    (d) => {
      d.design.sections[0].settings.image = '//example.com/image.png';
    },
    (d) => {
      d.design.sections[0].settings.image = '/\\example.com/image.png';
    },
    (d) => {
      d.design.sections[0].settings.padding = 9999;
    },
    (d) => {
      d.design = null;
    },
  ];
  for (const mutate of invalid) {
    const doc = document();
    mutate(doc);
    await assert.rejects(
      h.store.saveSiteDraft(doc, actor),
      errors.PlatformError,
    );
  }
  assert.equal(h.writes(), 0);
});

test('a concurrent save is retried and its history is retained', async () => {
  const h = harness();
  const doc = document();
  await h.store.saveSiteDraft(doc, actor);
  h.beforeUpdate((row) => {
    h.beforeUpdate(undefined);
    row.draft._cmsVersions.unshift({
      id: 'concurrent',
      label: 'Outra sessão',
      createdAt: new Date().toISOString(),
      kind: 'draft',
      content: copy(doc),
    });
  });
  doc.title = 'Depois do conflito';
  const state = await h.store.publishSite(doc, actor);
  assert.equal(state.published.title, doc.title);
  assert.ok(state.versions.some((v) => v.id === 'concurrent'));
  assert.equal(h.writes(), 2);
});

test('persistent write conflicts surface a recoverable error without publishing', async () => {
  const h = harness();
  let serial = 0;
  h.beforeUpdate((row) => {
    row.draft = { ...content.siteContent, title: `Other ${serial++}` };
  });
  await assert.rejects(
    h.store.publishSite(document(), actor),
    (error) => error.status === 409,
  );
  assert.equal(h.writes(), 0);
  assert.equal(h.row().published, null);
});
