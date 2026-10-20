import type { Page } from 'playwright-core';

export class PortoLoginError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PortoLoginError';
  }
}

const NOTIFICATIONS_CHECK_URL =
  'https://prestador.portoseguro.com.br/portal/site/pdp/template.SINGLEPORTLET/menuitem.3f12931f95bf6da799d174c40812f1ca/resource.process/' +
  '?javax.portlet.tpst=f97e78b2cfc63db9233ec8510812f1ca' +
  '&javax.portlet.rid_f97e78b2cfc63db9233ec8510812f1ca=getNotificacoesCount' +
  '&javax.portlet.rcl_f97e78b2cfc63db9233ec8510812f1ca=cacheLevelPage' +
  '&javax.portlet.begCacheTok=com.vignette.cachetoken' +
  '&javax.portlet.endCacheTok=com.vignette.cachetoken';

async function verifyPortoSession(page: Page): Promise<{ ok: boolean; status: number | null; bodySnippet: string }> {
  const response = await page
    .request.post(NOTIFICATIONS_CHECK_URL, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      data: 'origemId=655',
    })
    .catch(() => null);

  if (!response) return { ok: false, status: null, bodySnippet: '(sem resposta)' };

  const text = await response.text().catch(() => '');
  return {
    ok: response.ok() && /^\{"count"/.test(text.trim()),
    status: response.status(),
    bodySnippet: text.slice(0, 200),
  };
}

/**
 * Logs into the Porto Seguro provider portal (prestador.portoseguro.com.br) using a real page,
 * so the browser executes the site's own scripts naturally. Validated against production: a plain
 * HTTP-only login (no page rendering) authenticates on this subdomain but the session is never
 * recognized by the separate wwws.portoseguro.com.br app where schedule/hours actually live —
 * only a full page-driven login consistently works for both.
 */
export async function loginToPorto(page: Page, credentials: { cpf: string; password: string }): Promise<void> {
  try {
    await page.goto('https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
  } catch (error) {
    throw new PortoLoginError('Não foi possível abrir a página de login do Porto.', error);
  }

  await page.fill('#cpf', credentials.cpf);
  await page.fill('input[name="password"]', credentials.password);

  // Clicking "entrar" triggers populateWithQRAsForCpf(), an async AJAX call that looks up which
  // QRA(s) belong to this CPF before the page decides whether to auto-submit (single QRA) or show
  // a picker modal (multiple QRAs). Waiting for that specific response — instead of an implicit
  // delay — avoids a race where we check for the modal / consider login done before the site's
  // own JS has had a chance to act on it.
  const qraLookupPromise = page
    .waitForResponse((res) => res.url().includes('/pdp-service/api/public/login/users/qras/'), { timeout: 15000 })
    .catch(() => null);

  await page.click('input.inputEntrar[value="entrar"]');

  const qraResponse = await qraLookupPromise;
  const qraStatus = qraResponse?.status() ?? null;
  const qraBody = qraResponse ? await qraResponse.text().catch(() => '') : '';

  // Give the client JS a beat to act on the response (auto-submit or render the modal) before
  // checking page state — the network response resolving doesn't guarantee the JS callback has
  // finished running yet.
  await page.waitForTimeout(1500);

  // Accounts linked to a single QRA (the common case) log in directly. If the CPF has more than
  // one QRA, the site shows a selection modal — handled defensively here, but not exercised
  // against a real multi-QRA account yet.
  const modalVisible = await page.isVisible('#modal-qra').catch(() => false);
  if (modalVisible) {
    const options = await page
      .$$eval('#susepSelect option', (opts) => opts.map((option) => (option as HTMLOptionElement).value).filter(Boolean))
      .catch(() => [] as string[]);

    if (options.length) {
      await page.selectOption('#susepSelect', options[0]);
      await page.click('.btn-submit');
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const session = await verifyPortoSession(page);
  if (!session.ok) {
    const diagnostics = `url=${page.url()} qraLookup(status=${qraStatus}, body="${qraBody.slice(0, 200)}") modalVisible=${modalVisible} sessionCheck(status=${session.status}, body="${session.bodySnippet}")`;
    throw new PortoLoginError(`Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (${diagnostics})`);
  }
}
