// Relative imports only (none needed): shared by the VPS worker and the Next.js app.

/**
 * A Porto screen no longer looks like what the robot expects (missing iframe, a search that
 * ignores the period, a calendar on the wrong month). Thrown by lib/porto-integration so the job
 * can tell "the portal changed, the robot needs a fix on the VPS" apart from ordinary failures.
 */
export class PortoLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortoLayoutError';
  }
}

/**
 * Playwright's TimeoutError after a successful login almost always means a selector stopped
 * matching — the portal being offline fails earlier, at the login page.
 */
export function isPortoLayoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'PortoLayoutError' || error.name === 'TimeoutError');
}

export const PORTO_LAYOUT_ALERT_TITLE = 'o Portal do Porto parece ter mudado de tela — o robô precisa de ajuste na VPS';
