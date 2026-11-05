// What the Config. Porto screen tells the admin, worked out from the plain data (the settings row, the last runs, the
// technicians, the clock): where the robot stands, what is left to set up, what needs attention and when it runs
// next. Pure (no database, no React), so it is tested and the screen only draws it.
import { jobDetailActionLabel, type PortoJobDetail } from './porto-ui-helpers';
import { describePortoError } from './porto-login-errors';

export type PortoConfigLite = {
  cpf: string;
  has_password: boolean;
  automation_enabled: boolean;
  dry_run_only: boolean;
  last_error?: string | null;
  last_login_test_at?: string | null;
  last_login_test_ok?: boolean | null;
  last_login_test_message?: string | null;
};

export type PortoLogLite = {
  id: string;
  job_type: 'hours' | 'schedule';
  started_at: string;
  finished_at: string | null;
  status: string;
  technicians_processed: number;
  rows_written: number;
  error_message: string | null;
  details: PortoJobDetail[] | null;
  layout_suspect?: boolean;
  run_trigger?: 'auto' | 'manual' | null;
};

export type TechnicianLite = { id: string; name: string; qra: string | null; status: string };

/** Off, on but only showing what it would do, or on for real. */
export type PortoMode = 'off' | 'test' | 'live';
export type PortoOverall = 'not_set_up' | 'off' | 'testing' | 'ok' | 'attention';
export type Tone = 'neutral' | 'warning' | 'success' | 'danger';

export function modeOf(config: Pick<PortoConfigLite, 'automation_enabled' | 'dry_run_only'>): PortoMode {
  if (!config.automation_enabled) return 'off';
  return config.dry_run_only ? 'test' : 'live';
}

export function modeFlags(mode: PortoMode) {
  // "Off" keeps the test flag on, so turning it back on starts in test, never straight into writing.
  return { automation_enabled: mode !== 'off', dry_run_only: mode !== 'live' };
}

// ------------------------------------------------------------------------------------------------ the clock (Brasília)

const TZ = 'America/Sao_Paulo';

function clockOf(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const addDay = (day: string, amount: number) => new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);

/** "hoje às 22:06", "ontem às 22:06" or "26/10 às 22:06". */
export function whenLabel(iso: string | null, now: Date): string {
  if (!iso) return 'nunca';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return 'nunca';
  const then = clockOf(moment);
  const today = clockOf(now).day;
  const prefix = then.day === today ? 'hoje' : then.day === addDay(today, -1) ? 'ontem' : `${then.day.slice(8, 10)}/${then.day.slice(5, 7)}`;
  return `${prefix} às ${then.time}`;
}

/** The next time a daily job at "HH:MM" runs: "hoje às 23:00" or "amanhã às 03:00". */
export function nextRunLabel(time: string, now: Date): string {
  const [hours, minutes] = time.split(':').map(Number);
  const clock = clockOf(now);
  return hours * 60 + minutes > clock.minutes ? `hoje às ${time}` : `amanhã às ${time}`;
}

// ------------------------------------------------------------------------------------------------ describing a run

/** What a run did that the admin may want to look at (as opposed to what simply went as planned). */
const WARNING_ACTIONS = new Set([
  'skipped_no_match',
  'no_completion_time',
  'invalid_hours',
  'escala_fetch_failed',
  'escala_fetch_failed_fallback_0800',
  'time_budget_exceeded_stopping_early',
  'service_detail_failed',
  'technician_not_in_porto_list',
  'service_name_not_in_porto_list',
  'ambiguous_service_name',
  'laudo_unreadable_used_concluido',
  'start_time_fallback_escala',
]);

export function countWarnings(details: PortoJobDetail[] | null | undefined) {
  return (details ?? []).filter((detail) => typeof detail.action === 'string' && WARNING_ACTIONS.has(detail.action)).length;
}

export type RunKind = 'ok' | 'warning' | 'error' | 'test' | 'running' | 'skipped';

export type RunSummary = {
  id: string;
  job: 'hours' | 'schedule';
  title: string;
  kind: RunKind;
  label: string;
  summary: string;
  when: string;
  trigger: 'Automática' | 'Manual' | 'Teste' | '';
  warnings: number;
  problem: boolean;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function describeRun(log: PortoLogLite, now: Date): RunSummary {
  const warnings = countWarnings(log.details);
  const title = log.job_type === 'hours' ? 'Horas trabalhadas' : 'Escala';
  const technicians = plural(log.technicians_processed, 'técnico', 'técnicos');

  let kind: RunKind;
  let label: string;
  if (log.status === 'running') (kind = 'running'), (label = 'Em andamento');
  else if (log.status === 'error') (kind = 'error'), (label = 'Falhou');
  else if (log.status === 'skipped') (kind = 'skipped'), (label = 'Não rodou (desligado)');
  else if (log.status === 'dry_run') (kind = 'test'), (label = warnings ? 'Teste, com avisos' : 'Teste: nada foi gravado');
  else if (log.status === 'partial' || warnings > 0 || log.layout_suspect) (kind = 'warning'), (label = 'Com avisos');
  else (kind = 'ok'), (label = 'Tudo certo');

  let summary = '';
  if (kind === 'error') summary = describePortoError(log.error_message).message;
  else if (kind === 'running') summary = 'Importando agora…';
  else if (kind === 'skipped') summary = '';
  else if (kind === 'test') summary = `${technicians} conferidos`;
  else summary = log.job_type === 'hours' ? `${technicians} · ${plural(log.rows_written, 'dia gravado', 'dias gravados')}` : `${technicians} · ${plural(log.rows_written, 'dia de escala', 'dias de escala')}`;

  return {
    id: log.id,
    job: log.job_type,
    title,
    kind,
    label,
    summary,
    when: whenLabel(log.started_at, now),
    trigger: log.status === 'dry_run' ? 'Teste' : log.run_trigger === 'manual' ? 'Manual' : log.run_trigger === 'auto' ? 'Automática' : '',
    warnings,
    problem: kind === 'error' || kind === 'warning',
  };
}

// ------------------------------------------------------------------------------------------------ the whole picture

export type StepKey = 'account' | 'technicians' | 'simulation' | 'live';
export type Step = { key: StepKey; title: string; description: string; done: boolean; current: boolean };

export type ProblemAction = 'account' | 'match' | 'logs' | 'wizard';
export type Problem = { key: string; tone: Tone; title: string; detail: string; action?: ProblemAction; actionLabel?: string };

export type PortoStatus = {
  mode: PortoMode;
  overall: PortoOverall;
  tone: Tone;
  headline: string;
  detail: string;
  steps: Step[];
  setupComplete: boolean;
  problems: Problem[];
  lastRun: { hours: RunSummary | null; schedule: RunSummary | null };
  nextRun: { hours: string | null; schedule: string | null };
  technicians: { active: number; linked: number; unlinked: TechnicianLite[] };
  recent: RunSummary[];
};

const FINISHED = new Set(['success', 'partial', 'error', 'dry_run']);

export function buildPortoStatus(input: {
  config: PortoConfigLite;
  logs: PortoLogLite[];
  technicians: TechnicianLite[];
  times: { hours: string; schedule: string };
  now: Date;
  serverDown?: boolean;
}): PortoStatus {
  const { config, logs, now } = input;
  const mode = modeOf(config);
  const hasCredentials = Boolean(config.cpf) && config.has_password;

  const active = input.technicians.filter((technician) => technician.status === 'active');
  const unlinked = active.filter((technician) => !String(technician.qra ?? '').trim());
  const technicians = { active: active.length, linked: active.length - unlinked.length, unlinked };

  const recent = logs.map((log) => describeRun(log, now));
  const latest = (job: 'hours' | 'schedule') => logs.find((log) => log.job_type === job && FINISHED.has(log.status));
  const lastHours = latest('hours');
  const lastSchedule = latest('schedule');
  const lastRun = { hours: lastHours ? describeRun(lastHours, now) : null, schedule: lastSchedule ? describeRun(lastSchedule, now) : null };

  const accountDone = hasCredentials && config.last_login_test_ok === true;
  const technicianDone = technicians.active > 0 && unlinked.length === 0;
  const simulationDone = logs.some((log) => log.status === 'dry_run' || log.status === 'success' || log.status === 'partial');

  const steps: Step[] = [
    { key: 'account', title: 'Conectar a conta do Porto', description: 'O mesmo CPF e senha que você usa no Portal do Prestador.', done: accountDone, current: false },
    { key: 'technicians', title: 'Vincular os técnicos', description: 'Cada técnico precisa do QRA dele no Porto para o robô achar as horas.', done: technicianDone, current: false },
    { key: 'simulation', title: 'Simular uma importação', description: 'Roda tudo como se fosse valendo, mas não grava nada. Leva alguns minutos.', done: simulationDone, current: false },
    { key: 'live', title: 'Gravar de verdade', description: 'Liga a importação automática: todo dia as horas e a escala entram sozinhas.', done: mode === 'live', current: false },
  ];
  const firstOpen = steps.find((step) => !step.done);
  if (firstOpen) firstOpen.current = true;

  // What needs attention, most serious first.
  const problems: Problem[] = [];
  if (hasCredentials && config.last_login_test_ok === false) {
    problems.push({ key: 'login', tone: 'danger', title: 'O login no Porto não funcionou', detail: config.last_login_test_message ? describePortoError(config.last_login_test_message).message : 'Confira o CPF e a senha. Se trocou a senha no Porto, troque aqui também.', action: 'account', actionLabel: 'Atualizar a senha' });
  }
  if (input.serverDown) {
    problems.push({ key: 'server', tone: 'warning', title: 'O servidor do robô está em manutenção', detail: 'As importações ficam paradas até ele voltar.' });
  }
  for (const job of ['hours', 'schedule'] as const) {
    const log = latest(job);
    if (!log || mode === 'off') continue;
    const name = job === 'hours' ? 'das horas' : 'da escala';
    if (log.layout_suspect) {
      problems.push({ key: `layout-${job}`, tone: 'danger', title: 'O Portal do Porto parece ter mudado de tela', detail: 'O robô não leu o portal como esperado. A equipe já foi avisada.', action: 'logs', actionLabel: 'Ver o que aconteceu' });
    } else if (log.status === 'error') {
      problems.push({ key: `error-${job}`, tone: 'danger', title: `A última importação ${name} falhou`, detail: describePortoError(log.error_message).message, action: 'logs', actionLabel: 'Ver detalhes' });
    } else if (log.status === 'partial') {
      problems.push({ key: `partial-${job}`, tone: 'warning', title: `A importação ${name} terminou com avisos`, detail: 'Parte dos dados não entrou.', action: 'logs', actionLabel: 'Ver avisos' });
    }
  }
  if (technicians.active > 0 && unlinked.length > 0) {
    const names = unlinked.slice(0, 3).map((technician) => technician.name).join(', ');
    problems.push({ key: 'unlinked', tone: 'warning', title: unlinked.length === 1 ? '1 técnico sem QRA do Porto' : `${unlinked.length} técnicos sem QRA do Porto`, detail: `${names}${unlinked.length > 3 ? ' e outros' : ''}.`, action: 'match', actionLabel: 'Vincular técnicos' });
  }
  if (mode !== 'off') {
    const lastAt = [lastHours, lastSchedule].filter(Boolean).map((log) => new Date(log!.started_at).getTime());
    const newest = lastAt.length ? Math.max(...lastAt) : 0;
    if (hasCredentials && lastAt.length && now.getTime() - newest > 2 * 86_400_000) {
      problems.push({ key: 'stale', tone: 'warning', title: 'Nenhuma importação nos últimos 2 dias', detail: 'Deveria rodar todo dia.', action: 'wizard', actionLabel: 'Importar agora' });
    }
  }

  // The warnings the latest runs found that the admin can fix from here.
  const details = [lastHours, lastSchedule].flatMap((log) => log?.details ?? []);
  const withoutTechnician = details.filter((detail) => detail.action === 'skipped_no_match').length;
  if (withoutTechnician > 0 && !problems.some((problem) => problem.key === 'unlinked')) {
    problems.push({ key: 'no-match', tone: 'warning', title: plural(withoutTechnician, 'socorrista do Porto sem técnico no sistema', 'socorristas do Porto sem técnico no sistema'), detail: 'Nenhum técnico seu tem o QRA deles.', action: 'match', actionLabel: 'Vincular técnicos' });
  }
  const notInPorto = details.filter((detail) => detail.action === 'technician_not_in_porto_list');
  if (notInPorto.length) {
    const names = notInPorto.slice(0, 3).map((detail) => String(detail.technician_name ?? detail.qra ?? '')).filter(Boolean).join(', ');
    problems.push({ key: 'not-in-porto', tone: 'warning', title: `${jobDetailActionLabel('technician_not_in_porto_list')}`, detail: names ? `Confira o QRA de: ${names}.` : 'Confira o QRA deles.', action: 'match', actionLabel: 'Conferir QRAs' });
  }
  const rank = { danger: 0, warning: 1, neutral: 2, success: 3 } as const;
  problems.sort((a, b) => rank[a.tone] - rank[b.tone]);

  const serious = problems.find((problem) => problem.tone === 'danger');
  const setupComplete = steps.every((step) => step.done);

  let overall: PortoOverall;
  let tone: Tone;
  let headline: string;
  let detail: string;
  if (!hasCredentials) {
    overall = 'not_set_up';
    tone = 'neutral';
    headline = 'Conecte a sua conta do Porto';
    detail = 'Informe o CPF e a senha do Portal do Prestador.';
  } else if (mode === 'off') {
    overall = 'off';
    tone = 'neutral';
    headline = 'A importação está desligada';
    detail = 'Nada é importado do Porto.';
  } else if (mode === 'test') {
    overall = 'testing';
    tone = 'warning';
    headline = 'Em teste: nada está sendo gravado';
    detail = 'O robô só mostra o que faria.';
  } else if (serious) {
    overall = 'attention';
    tone = 'danger';
    headline = serious.title;
    detail = serious.detail;
  } else if (problems.length) {
    overall = 'attention';
    tone = 'warning';
    headline = problems[0].title;
    detail = problems[0].detail;
  } else {
    overall = 'ok';
    tone = 'success';
    headline = 'Funcionando';
    detail = lastRun.hours ? `Última importação de horas ${lastRun.hours.when}: ${lastRun.hours.summary || lastRun.hours.label.toLowerCase()}.` : 'Ligada. A primeira importação é no próximo horário.';
  }

  return {
    mode,
    overall,
    tone,
    headline,
    detail,
    steps,
    setupComplete,
    problems,
    lastRun,
    nextRun: {
      hours: mode === 'off' ? null : nextRunLabel(input.times.hours, now),
      schedule: mode === 'off' ? null : nextRunLabel(input.times.schedule, now),
    },
    technicians,
    recent,
  };
}

/** Matches Porto socorristas with technicians by name when there is no QRA to go by (accents and case ignored). */
export function suggestTechnician(portoName: string, technicians: Array<{ id: string; name: string; qra: string | null }>) {
  const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = fold(portoName);
  if (!target) return null;
  const exact = technicians.filter((technician) => fold(technician.name) === target);
  return exact.length === 1 ? exact[0] : null;
}
