import type { Frame, Page } from 'playwright-core';
import { PortoLayoutError } from '../porto-layout';

/**
 * Opens a Porto portal page through its proper menu/iframe wrapper on prestador.portoseguro.com.br
 * and returns the real nested iframe (on wwws.portoseguro.com.br) where the actual content lives.
 *
 * Validated live: navigating directly to a wwws.portoseguro.com.br detail page with `page.goto`
 * (bypassing this wrapper) gets rejected with "Acesso proibido" — Porto checks that the page was
 * reached through the normal portal navigation flow, not a deep link. The top-level list pages
 * (e.g. ConSocor.xhtml) tolerate direct navigation, but detail pages do not — always go through
 * this helper (or a real click from an already-open list) for anything beyond a list.
 */
export async function openPortalFrame(page: Page, menuId: string, targetUrl: string): Promise<Frame> {
  const wrapperUrl = `https://prestador.portoseguro.com.br/pdp/iframe?menuid=${menuId}&javax.portlet.ctx_iframe=url=${targetUrl}`;
  await page.goto(wrapperUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith('https://wwws.portoseguro.com.br'));
  if (!frame) {
    throw new PortoLayoutError(`Não foi possível localizar o iframe real do Porto para ${targetUrl}`);
  }

  return frame;
}
