import type { Page } from 'playwright-core';
import { openPortalFrame } from './navigation';

export type PortoSocorrista = {
  qra: string;
  name: string;
  cpf?: string;
  status: string;
};

const SOCORRISTAS_MENU_ID = 'PDP-00192';
const SOCORRISTAS_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2';

/**
 * Lists socorristas (technicians) registered in the Porto portal.
 *
 * Validated against production: columns are CPF | QRA | SOCORRISTA | CELULAR | STATUS.
 *
 * KNOWN LIMITATION: this only reads the first page of results (confirmed ~12 rows on the
 * account tested). The list uses a "load more on scroll" endpoint (LazyScrollTableSocorristas.jsp)
 * for accounts with more technicians than fit on one page — that endpoint was not captured/
 * validated, so technicians beyond the first page are silently not returned here. If the roster
 * grows, `porto_sync_log.technicians_processed` will make the shortfall visible for follow-up.
 */
export async function listSocorristas(page: Page): Promise<PortoSocorrista[]> {
  const frame = await openPortalFrame(page, SOCORRISTAS_MENU_ID, SOCORRISTAS_URL);

  return frame.evaluate(() => {
    const isQra = (value: string) => /^\d{4,10}$/.test(value.trim());

    return Array.from(document.querySelectorAll('table tr'))
      .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() ?? ''))
      .filter((cells) => cells.length >= 5 && isQra(cells[1]))
      .map((cells) => ({
        cpf: cells[0] || undefined,
        qra: cells[1],
        name: cells[2],
        status: cells[4],
      }));
  });
}
