import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { loginToPorto } from './login';

const PORTO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Launches a Chromium browser for scraping the Porto Seguro provider portal.
 *
 * On Vercel/Lambda this uses @sparticuz/chromium's serverless-compatible binary.
 * For local development, install a Chromium build once with `npx playwright install chromium`
 * — playwright-core auto-discovers browsers installed that way, no extra config needed.
 */
export async function launchPortoBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const serverless = isServerlessRuntime();

  const browser = await playwrightChromium.launch({
    args: serverless ? chromium.args : [],
    executablePath: serverless ? await chromium.executablePath() : undefined,
    headless: true,
  });

  const context = await browser.newContext({
    userAgent: PORTO_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });

  return { browser, context };
}

/**
 * Launches a browser and logs in, retrying once on failure. Headless Chromium occasionally fails
 * to fully come up on a cold serverless container ("Target page, context or browser has been
 * closed" within ~1s of launch, observed in production) — a single retry with a short backoff
 * clears this most of the time. Only used by the two unattended cron routes; the manual
 * "Testar login" button intentionally does its own single-attempt flow since a human is present
 * to just click again, and wants to see the raw failure for diagnostics either way.
 */
export async function launchAuthenticatedPortoSession(
  credentials: { cpf: string; password: string },
  options: { maxAttempts?: number } = {},
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const maxAttempts = options.maxAttempts ?? 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { browser, context } = await launchPortoBrowser();
    try {
      const page = await context.newPage();
      await loginToPorto(page, credentials);
      return { browser, context, page };
    } catch (error) {
      lastError = error;
      await browser.close().catch(() => {});
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  throw lastError;
}
