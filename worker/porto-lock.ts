/**
 * Porto browser sessions on the shared VPS.
 *
 * - Per organization, one session at a time: every job and admin action of an organization logs into
 *   the same Porto account, and two overlapping sessions can invalidate each other mid-run.
 * - Across organizations, at most `maxBrowsers` sessions at once (platform settings, default 2). The
 *   VPS has 2 cores and 12 GB without swap and also runs the WhatsApp server and another system's
 *   worker: more browsers risk the memory (the kernel would kill processes), slow every page down
 *   into false "the screens changed" alerts, and make many simultaneous logins from one IP.
 *
 * Scheduled runs wait for both. Admin requests are refused right away when their organization is
 * busy (409), and after a short wait when every browser slot is taken.
 */

type Holder = { name: string; startedAt: number; done: Promise<void> };

const organizationLocks = new Map<string, Holder>();

let maxBrowsers = 2;
let activeBrowsers = 0;
const slotWaiters: Array<() => void> = [];

export class PortoBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortoBusyError';
  }
}

/** Applied by the scheduler from the platform settings; waiting runs start as soon as a slot frees. */
export function setMaxBrowsers(value: number) {
  if (!Number.isInteger(value) || value < 1) return;
  maxBrowsers = value;
  while (activeBrowsers < maxBrowsers && slotWaiters.length) {
    activeBrowsers++;
    slotWaiters.shift()!();
  }
}

/** Takes a browser slot, waiting up to `timeoutMs` (forever when omitted). False when it timed out. */
function acquireSlot(timeoutMs?: number): Promise<boolean> {
  if (activeBrowsers < maxBrowsers) {
    activeBrowsers++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    const waiter = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    slotWaiters.push(waiter);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const index = slotWaiters.indexOf(waiter);
        if (index >= 0) slotWaiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
    }
  });
}

function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) next(); // the slot passes straight to the next waiter
  else activeBrowsers = Math.max(0, activeBrowsers - 1);
}

function takeOrganizationLock(organizationId: string, name: string) {
  let release!: () => void;
  const holder: Holder = { name, startedAt: Date.now(), done: new Promise<void>((resolve) => (release = resolve)) };
  organizationLocks.set(organizationId, holder);
  return () => {
    if (organizationLocks.get(organizationId) === holder) organizationLocks.delete(organizationId);
    release();
  };
}

/** How long an admin request waits for a free browser before being told to try again. */
const ADMIN_SLOT_WAIT_MS = 20_000;

/**
 * For admin requests: runs `fn` holding the organization's lock and a browser slot. Throws
 * PortoBusyError right away when the organization already has a run, or after a short wait when
 * every browser is busy with other organizations.
 */
export async function runWithPortoLock<T>(organizationId: string, name: string, fn: () => Promise<T>): Promise<T> {
  const held = organizationLocks.get(organizationId);
  if (held) {
    throw new PortoBusyError(`Já existe uma execução do Porto em andamento (${held.name}). Tente de novo quando ela terminar.`);
  }
  const releaseLock = takeOrganizationLock(organizationId, name);
  try {
    if (!(await acquireSlot(ADMIN_SLOT_WAIT_MS))) {
      throw new PortoBusyError('O robô do Porto está ocupado com as importações de outras empresas. Tente de novo em alguns minutos.');
    }
    try {
      return await fn();
    } finally {
      releaseSlot();
    }
  } finally {
    releaseLock();
  }
}

/** For scheduled runs: waits for the organization's lock and then for a browser slot. */
export async function waitForPortoLock<T>(organizationId: string, name: string, fn: () => Promise<T>): Promise<T> {
  for (let held = organizationLocks.get(organizationId); held; held = organizationLocks.get(organizationId)) {
    await held.done;
  }
  const releaseLock = takeOrganizationLock(organizationId, name);
  try {
    await acquireSlot();
    try {
      return await fn();
    } finally {
      releaseSlot();
    }
  } finally {
    releaseLock();
  }
}

/** What each organization is running and for how long — for the stuck-run watchdog and the panel. */
export function portoLockInfo(): Array<{ organizationId: string; name: string; heldForMs: number }> {
  return Array.from(organizationLocks, ([organizationId, holder]) => ({
    organizationId,
    name: holder.name,
    heldForMs: Date.now() - holder.startedAt,
  }));
}

export function portoCapacity() {
  return { maxBrowsers, activeBrowsers, waiting: slotWaiters.length };
}
