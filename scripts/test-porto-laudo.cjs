// Run with: node scripts/test-porto-laudo.cjs
// The laudo grace period, the settings that drive it and the day "Fim do expediente" reports.
// Pure logic: no browser, no database (a dummy DATABASE_URL only lets the modules load).
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost/none';
process.env.JWT_SECRET ??= 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const settingsLib = require('../lib/organization-settings.ts');
const { laudoGraceWindow, brasiliaInstant } = require('../lib/porto-laudo.ts');
const { dailyHoursDay } = require('../lib/whatsapp/notifications.ts');

const { DEFAULT_ORGANIZATION_SETTINGS: defaults, normalizeOrganizationSettings, parseOrganizationSettingsInput, endOfWorkDayMinutes } = settingsLib;

/** An instant in Brasília time (UTC-3). */
const at = (iso) => new Date(`${iso}-03:00`);

test('settings: grace period and reprocess window', () => {
  assert.equal(defaults.portoLaudoGraceHours, 6);
  assert.equal(normalizeOrganizationSettings({}).portoLaudoGraceHours, 6);
  // Stored values are read back; invalid ones fall to the default.
  assert.equal(normalizeOrganizationSettings({ porto_laudo_grace_hours: '12.50' }).portoLaudoGraceHours, 12.5);
  assert.equal(normalizeOrganizationSettings({ porto_laudo_grace_hours: '72' }).portoLaudoGraceHours, 6);
  assert.equal(normalizeOrganizationSettings({ porto_reprocess_days: 0 }).portoReprocessDays, 1);

  const valid = (patch) => parseOrganizationSettingsInput({ ...defaults, ...patch });
  assert.equal(valid({ portoLaudoGraceHours: 0 }).error, undefined);
  assert.equal(valid({ portoLaudoGraceHours: 48 }).error, undefined);
  assert.match(valid({ portoLaudoGraceHours: 49 }).error, /entre 0 e 48 horas/);
  assert.match(valid({ portoLaudoGraceHours: -1 }).error, /entre 0 e 48 horas/);
  assert.equal(valid({ portoReprocessDays: 1 }).error, undefined);
  assert.equal(valid({ portoReprocessDays: 7 }).error, undefined);
  assert.match(valid({ portoReprocessDays: 0 }).error, /entre 1 e 7/);
  assert.match(valid({ portoReprocessDays: 8 }).error, /entre 1 e 7/);
});

test('laudo: filled in time, pending before the deadline, warning after it', () => {
  const grace = { endDate: '08/10/2026', workEnd: '18:00', graceHours: 6 };
  // Concluído at 18:00 → deadline 00:00 on the 9th.
  const early = laudoGraceWindow({ ...grace, now: at('2026-10-08T23:00').getTime() });
  assert.equal(early.pending, true, 'a run at 23:00 is inside the window: LAUDO PENDENTE, recomputed next run');
  assert.equal(early.graceEndsAt.toISOString(), at('2026-10-09T00:00').toISOString());
  const late = laudoGraceWindow({ ...grace, now: at('2026-10-09T00:30').getTime() });
  assert.equal(late.pending, false, 'after the deadline a missing laudo is the warning (never recomputed)');
  const exactly = laudoGraceWindow({ ...grace, now: at('2026-10-09T00:00').getTime() });
  assert.equal(exactly.pending, false, 'the deadline itself is already over');
  // 0 = warning right away.
  assert.equal(laudoGraceWindow({ ...grace, graceHours: 0, now: at('2026-10-08T18:00').getTime() }).pending, false);
  // A service finished at 23:30 reaches into the next day.
  assert.equal(laudoGraceWindow({ endDate: '08/10/2026', workEnd: '23:30', graceHours: 6, now: at('2026-10-09T05:00').getTime() }).pending, true);
  assert.equal(brasiliaInstant('01/02/2026', '8:05').toISOString(), at('2026-02-01T08:05').toISOString());
});

test('Fim do expediente: reports the day that ended', () => {
  const settings = { defaultShiftEnd: '18:00' };
  assert.equal(endOfWorkDayMinutes(settings), 20 * 60);
  assert.equal(endOfWorkDayMinutes({ defaultShiftEnd: '23:30' }), 23 * 60 + 59, 'capped at the end of the day');
  // 00:30 → the day that just ended; 10:00 → still yesterday; 19:59 → yesterday; 20:00 and after → today.
  assert.equal(dailyHoursDay(at('2026-10-09T00:30'), settings), '2026-10-08');
  assert.equal(dailyHoursDay(at('2026-10-09T10:00'), settings), '2026-10-08');
  assert.equal(dailyHoursDay(at('2026-10-08T19:59'), settings), '2026-10-07');
  assert.equal(dailyHoursDay(at('2026-10-08T20:00'), settings), '2026-10-08');
  assert.equal(dailyHoursDay(at('2026-10-08T23:00'), settings), '2026-10-08');
  // Month boundary.
  assert.equal(dailyHoursDay(at('2026-11-01T00:30'), settings), '2026-10-31');
});
