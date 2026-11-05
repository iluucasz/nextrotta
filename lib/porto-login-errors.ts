/**
 * Turns what the Porto portal answered during a login into a sentence the company can act on.
 * Pure (no dependencies): used by the login itself (worker), by the API routes that proxy the worker
 * and by the screens, so a message stored by an older worker version is cleaned up the same way.
 *
 * What the portal really answers (seen live, kept in porto_sync_log):
 *  - wrong data: qraLookup 200 with {"status":"invalid","message":"Erro ao realizar a consulta dos dados"}
 *  - password expired (05/11/2026): qraLookup 200 with an empty body and the portal opens the "ALTERAR SENHA" window
 *    ("A sua senha expirou. Por favor escolha uma nova."); the same empty body was seen after a password change
 *  - right data: {"status":"success","data":{"qras":[{"codQRA":"..."}]}}
 */

export type PortoLoginReason =
  | 'credentials_rejected'
  | 'password_expired'
  | 'no_confirmation'
  | 'no_qra'
  | 'session_not_opened'
  | 'blocked'
  | 'no_answer'
  | 'unexpected';

/** Said where the company cannot fix it alone: the screens turn it into a button to /admin/suporte. */
export const SUPPORT_HINT = 'Se continuar, abra um chamado em Suporte.';

/** Whether a message ends by sending the company to Suporte (screens show an "Abrir chamado" button then). */
export function needsSupport(message: string | null | undefined): boolean {
  return (message ?? '').includes(SUPPORT_HINT);
}

export const PORTO_LOGIN_MESSAGES: Record<PortoLoginReason, string> = {
  credentials_rejected: 'O Porto não aceitou o CPF ou a senha. Se você trocou a senha no Portal do Prestador, atualize aqui em “Alterar”.',
  password_expired:
    'A senha do Porto expirou. Entre no Portal do Prestador, escolha uma nova senha e depois atualize aqui em “Alterar”.',
  no_confirmation:
    `O Porto não confirmou o CPF e a senha. Se a senha expirou ou foi trocada no portal, atualize em “Alterar”; se estiver certa, o portal pode estar instável — tente em alguns minutos. ${SUPPORT_HINT}`,
  no_qra: 'O Porto aceitou a senha, mas esse CPF não tem QRA ativo. Confira o CPF em “Alterar”.',
  // The QRA lookup only checks CPF and password, so it answers normally even when the password has expired:
  // the portal asks for a new one in the next step, and that is what keeps the robot out.
  session_not_opened:
    `O Porto reconheceu o CPF e a senha, mas não deixou o robô entrar. Costuma ser senha expirada: entre no Portal do Prestador pelo navegador e, se pedir uma nova senha, troque e atualize aqui em “Alterar”. Se não pedir, o portal pode estar instável; tente em alguns minutos. ${SUPPORT_HINT}`,
  blocked: `O Porto bloqueou o acesso do robô por enquanto. Tente de novo mais tarde. ${SUPPORT_HINT}`,
  no_answer: `O Porto não respondeu. O portal pode estar fora do ar ou lento; tente de novo em alguns minutos. ${SUPPORT_HINT}`,
  unexpected: `O Porto respondeu de um jeito inesperado e o robô não conseguiu entrar. A tela de login pode ter mudado. ${SUPPORT_HINT}`,
};

const LOGIN_PAGE_NOT_OPENED = 'Não foi possível abrir a página de login do Porto.';
const LOGIN_PAGE_MESSAGE = `O Portal do Prestador não abriu. Ele pode estar fora do ar ou lento; tente de novo em alguns minutos. ${SUPPORT_HINT}`;
const MISSING_CREDENTIALS = 'Credenciais não configuradas.';
const MISSING_CREDENTIALS_MESSAGE = 'Falta cadastrar o CPF e a senha do Porto.';
const LEGACY_LOGIN_PREFIX = 'Login no Porto falhou';

export type PortoLoginSignals = {
  qraStatus: number | null;
  qraBody: string;
  sessionStatus: number | null;
  /** The login page is showing the portal's "your password expired" window. */
  passwordExpired?: boolean;
};

/** Which of the situations above the portal's answers point to. */
export function classifyLoginFailure(signals: PortoLoginSignals): PortoLoginReason {
  const { qraStatus, sessionStatus } = signals;
  const body = signals.qraBody.trim();

  // The only signal that names the cause: the portal itself says so on the page.
  if (signals.passwordExpired) return 'password_expired';
  if (qraStatus === 403 || qraStatus === 429 || sessionStatus === 403 || sessionStatus === 429) return 'blocked';
  if (/incapsula|imperva|request unsuccessful/i.test(body)) return 'blocked';
  if (qraStatus === null || qraStatus >= 500) return 'no_answer';

  if (!body) return 'no_confirmation';

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'unexpected';
  }
  if (!parsed || typeof parsed !== 'object') return 'unexpected';

  const record = parsed as { status?: unknown; data?: { qras?: unknown } };
  if (record.status === 'success') {
    const qras = record.data?.qras;
    return Array.isArray(qras) && qras.length === 0 ? 'no_qra' : 'session_not_opened';
  }
  if (typeof record.status === 'string') return 'credentials_rejected';
  return 'unexpected';
}

/** The text stored in the history: the sentence the company reads, then the technical trace in parentheses. */
export function buildLoginFailureMessage(reason: PortoLoginReason, diagnostics: string): string {
  return `${PORTO_LOGIN_MESSAGES[reason]} (${diagnostics})`;
}

/**
 * A rejected login is not tried again: it is already attempted twice inside a run, and repeating a
 * wrong password risks locking the Porto account. Recognises the old wording too (rows already stored).
 */
/** Wordings already stored in the history before they were rewritten. */
const PREVIOUS_SENTENCES = ['O Porto aceitou o CPF e a senha, mas não abriu a sessão.'];

export function isPortoLoginRejection(message: string | null | undefined): boolean {
  const text = message ?? '';
  if (text.startsWith(LEGACY_LOGIN_PREFIX)) return true;
  return [...Object.values(PORTO_LOGIN_MESSAGES), ...PREVIOUS_SENTENCES].some((sentence) => text.startsWith(sentence));
}

export type PortoErrorText = { message: string; technical: string | null };

/** Splits "sentence (url=… trace)" into the sentence and the trace. */
function splitTechnical(raw: string): PortoErrorText {
  const at = raw.indexOf(' (url=');
  if (at === -1) return { message: raw.trim(), technical: null };
  const technical = raw.slice(at + 2).replace(/\)\s*$/, '');
  return { message: raw.slice(0, at).trim(), technical: technical || null };
}

/** Reads the signals back out of the trace the old worker wrote, so old history rows get the new wording. */
function signalsFromTrace(trace: string): PortoLoginSignals | null {
  const qra = /qraLookup\(status=(\d+|null), body="([\s\S]*?)"\)\s*modalVisible=/.exec(trace);
  if (!qra) return null;
  const session = /sessionCheck\(status=(\d+|null)/.exec(trace);
  return {
    qraStatus: qra[1] === 'null' ? null : Number(qra[1]),
    qraBody: qra[2],
    sessionStatus: session && session[1] !== 'null' ? Number(session[1]) : null,
  };
}

/**
 * What the screen shows for an error stored by a Porto run or returned by the worker: a sentence the
 * company can act on, never the technical trace (kept in `technical` for whoever supports the account).
 */
export function describePortoError(raw: string | null | undefined): PortoErrorText {
  const text = (raw ?? '').trim();
  if (!text) return { message: 'Sem detalhe do erro.', technical: null };

  const { message, technical } = splitTechnical(text);

  if (text.startsWith(LEGACY_LOGIN_PREFIX)) {
    const signals = technical ? signalsFromTrace(technical) : null;
    return { message: PORTO_LOGIN_MESSAGES[signals ? classifyLoginFailure(signals) : 'no_confirmation'], technical };
  }
  if (isPortoLoginRejection(text)) return { message, technical };

  if (text.startsWith(LOGIN_PAGE_NOT_OPENED)) return { message: LOGIN_PAGE_MESSAGE, technical: text };
  if (text.startsWith(MISSING_CREDENTIALS)) return { message: MISSING_CREDENTIALS_MESSAGE, technical: null };

  // The worker wraps anything that was not a login rejection ("Falha ao testar login no Porto: <cause>").
  const wrapped = /^(Falha ao (?:testar login no Porto|buscar técnicos do Porto)):\s*([\s\S]*)$/.exec(text);
  if (wrapped) {
    return {
      message: wrapped[1].includes('testar')
        ? `Não foi possível testar o login agora. Tente de novo em alguns minutos. ${SUPPORT_HINT}`
        : `Não foi possível buscar os técnicos no Porto agora. Tente de novo em alguns minutos. ${SUPPORT_HINT}`,
      technical: wrapped[2].split('\n')[0].slice(0, 300) || null,
    };
  }

  // "Erro inesperado ao importar horas do Porto: frame.selectOption: Timeout 30000ms exceeded." — the cause is
  // the browser library talking, not something the company can read. Plain causes ("A busca … não terminou") stay.
  const unexpected = /^Erro inesperado ao importar (horas|escala)[^:]*:\s*([\s\S]*)$/.exec(text);
  if (unexpected && TECHNICAL_CAUSE.test(unexpected[2])) {
    return { message: PORTO_RUN_FAILED_MESSAGE, technical: unexpected[2].split('\n')[0].slice(0, 300) };
  }
  if (unexpected) return { message: `${text.replace(/\s+$/, '')} ${SUPPORT_HINT}`, technical: null };

  return { message: text, technical: null };
}

const TECHNICAL_CAUSE = /Timeout \d+ms|waiting for|locator|selector|selectOption|Target (page|closed)|browser has been closed|net::ERR|\b(page|frame|locator|browser|context)\.[a-zA-Z]+/i;

export const PORTO_RUN_FAILED_MESSAGE =
  `O robô não conseguiu usar uma tela do Portal do Prestador a tempo. Pode ser lentidão do portal ou senha expirada (entre no portal pelo navegador: se pedir nova senha, troque e atualize em “Alterar”). Se estiver tudo certo, tente de novo em alguns minutos. ${SUPPORT_HINT}`;

export type PortoLoginProblemInput = {
  hasCredentials: boolean;
  lastTest: { at: string | null; ok: boolean | null; message: string | null };
  /** The latest finished run of each job (hours, schedule). */
  runs: Array<{ started_at: string; status: string; error_message: string | null }>;
};

/**
 * Whether the Porto login is failing right now, and the sentence that says why. It is failing when the newest
 * evidence is a failure: a login test that failed, or a run that stopped on a rejected login — and no login test
 * or run has worked since. Looks at manual tests and runs too, so it does not depend on the worker raising an alert.
 */
export function findPortoLoginProblem(input: PortoLoginProblemInput): { message: string } | null {
  if (!input.hasCredentials) return null;

  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  let failure: { at: number; message: string } | null = null;
  let success = 0;

  const { lastTest } = input;
  if (lastTest.ok === false) failure = { at: time(lastTest.at), message: describePortoError(lastTest.message).message };
  if (lastTest.ok === true) success = Math.max(success, time(lastTest.at));

  for (const run of input.runs) {
    const at = time(run.started_at);
    if (run.status === 'error' && isPortoLoginRejection(run.error_message)) {
      if (!failure || at > failure.at) failure = { at, message: describePortoError(run.error_message).message };
    } else if (run.status === 'success' || run.status === 'partial') {
      success = Math.max(success, at);
    }
  }

  return failure && failure.at > success ? { message: failure.message } : null;
}

/** The bell entry for a login that does not work (the same text whoever raises it, so it shows once). */
export function portoLoginNotice(message: string): { title: string; body: string } {
  return {
    title: message === PORTO_LOGIN_MESSAGES.password_expired ? 'A senha do Porto expirou' : 'O robô do Porto não consegue entrar',
    body: `${message} Enquanto isso, as horas e a escala do Porto não são importadas.`,
  };
}
