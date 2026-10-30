import { Logger } from '@nestjs/common';
import { CaptureFailure } from '@moodboard/shared';
import { Browser, chromium, errors, Page, Response } from 'playwright';
import sharp from 'sharp';
import { EgressProxy, REFUSED_HEADER, Resolver, resolvePublic } from './egress-guard';

/** The viewport of every capture (§8.2): a common laptop, rendered at retina density. */
export const VIEWPORT = { width: 1440, height: 900 } as const;
export const DEVICE_SCALE_FACTOR = 2;

/** Taller pages are cut off in the full-page screenshot; WebP ends at 16,383 px (0011). */
export const MAX_FULL_PAGE_HEIGHT = 16_000;

const NAVIGATION_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_TIMEOUT_MS = 10_000;
/** The whole capture, launch to close. Past this the browser is closed under the page. */
const CAPTURE_TIMEOUT_MS = 120_000;

/** A capture that ended without a usable picture, and why (0011). */
export class CaptureError extends Error {
  constructor(
    readonly reason: CaptureFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface CaptureResult {
  /** Viewport screenshot at DPR 2, PNG. The asset's poster. */
  readonly poster: Buffer;
  /** Full-page screenshot at DPR 1, PNG, at most `MAX_FULL_PAGE_HEIGHT` tall. */
  readonly fullPage: Buffer;
  readonly pageTitle: string | null;
  /** `1440x900@2`, as `capture_tech.viewport` will record it. */
  readonly viewport: string;
}

/**
 * Scrolls down in steps so lazy images load and scroll-triggered animations finish, then back to
 * the top (§8.2 steps 4-5). A string, because it runs in the page, not in Node.
 */
const SCROLL_THROUGH = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const step = Math.round(window.innerHeight * 0.8);
  for (let i = 0; i < 60; i++) {
    const before = window.scrollY;
    window.scrollBy(0, step);
    await pause(150);
    if (window.scrollY === before || window.scrollY > ${MAX_FULL_PAGE_HEIGHT}) break;
  }
  window.scrollTo(0, 0);
  await pause(1000);
})()`;

const PAGE_HEIGHT = `Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)`;

/**
 * The deterministic capture (§8.1, 0011): no agent in the loop, the same steps for every URL, a
 * failure with a reason instead of a blank picture. One browser per capture — launching costs a
 * second, and nothing a page left behind can reach the next one.
 */
export class WebsiteCapturer {
  private readonly logger = new Logger(WebsiteCapturer.name);

  /** `resolve` is replaceable for tests only, which have nothing but loopback to serve from. */
  constructor(private readonly resolve: Resolver = resolvePublic) {}

  async capture(url: string): Promise<CaptureResult> {
    // Checked here once more before anything starts, so the common case — someone pasting an
    // internal address — fails fast with the right reason.
    const { hostname } = new URL(url);
    let address: string;
    try {
      address = await this.resolve(hostname);
    } catch (error) {
      throw new CaptureError('unreachable', `${hostname} does not resolve: ${String(error)}`);
    }
    if (address === 'forbidden') {
      throw new CaptureError('forbidden-target', `${hostname} is not a public host`);
    }

    const proxy = new EgressProxy(this.resolve);
    const browser = await chromium.launch({
      headless: true,
      proxy: { server: await proxy.start() },
    });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CaptureError('timeout', `The capture took longer than ${CAPTURE_TIMEOUT_MS / 1000} s`));
        // Closing under the page makes whatever it is waiting for fail, so the work stops too.
        void browser.close().catch(() => undefined);
      }, CAPTURE_TIMEOUT_MS);
    });
    const work = this.run(browser, url, proxy);
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      work.catch(() => undefined);
      await browser.close().catch(() => undefined);
      await proxy.close();
      if (proxy.refused.size > 0) {
        this.logger.warn(`Capture of ${url} refused ${[...proxy.refused].join(', ')}`);
      }
    }
  }

  private async run(browser: Browser, url: string, proxy: EgressProxy): Promise<CaptureResult> {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      locale: 'en-US',
      // "HeadlessChrome" in the user agent is the cheapest bot signal there is. This is not a
      // stealth plugin (out of scope for 0011), only the browser naming itself like Chrome does.
      userAgent: await userAgentOf(browser),
      acceptDownloads: false,
    });

    const page = await context.newPage();
    let response: Response | null;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // An https document the proxy refused fails its tunnel; the browser knows no more.
      if (proxy.refused.size > 0 && /ERR_TUNNEL_CONNECTION_FAILED/.test(String(error))) {
        throw new CaptureError('forbidden-target', `Refused to load ${[...proxy.refused].join(', ')}`);
      }
      throw navigationFailure(error);
    }
    await this.checkResponse(page, response);

    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {
      // Pages with polling or analytics never go quiet; "load" plus the scroll below is enough.
    });
    await page.evaluate(SCROLL_THROUGH);

    const poster = await page.screenshot({ type: 'png', animations: 'disabled' });
    if (await isBlank(poster)) {
      throw new CaptureError('blank', 'The page rendered as a single colour');
    }
    const height = Math.min(
      Math.max(Number(await page.evaluate(PAGE_HEIGHT)) || VIEWPORT.height, VIEWPORT.height),
      MAX_FULL_PAGE_HEIGHT,
    );
    const fullPage = await page.screenshot({
      type: 'png',
      fullPage: true,
      scale: 'css',
      animations: 'disabled',
      clip: { x: 0, y: 0, width: VIEWPORT.width, height },
    });
    const pageTitle = (await page.title()).trim().slice(0, 300) || null;

    return {
      poster,
      fullPage,
      pageTitle,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}@${DEVICE_SCALE_FACTOR}`,
    };
  }

  /** A challenge page is `blocked`, any other error status `http-error` (0011). */
  private async checkResponse(page: Page, response: Response | null): Promise<void> {
    if (!response) {
      return;
    }
    const status = response.status();
    if (status < 400) {
      return;
    }
    const headers = response.headers();
    // The proxy's own answer to a plain-http document, not the site's.
    if (headers[REFUSED_HEADER] === 'forbidden') {
      throw new CaptureError('forbidden-target', `Refused to load ${response.url()}`);
    }
    if (headers[REFUSED_HEADER] === 'unresolved') {
      throw new CaptureError('unreachable', `${new URL(response.url()).hostname} could not be reached`);
    }
    const body = await page.content().catch(() => '');
    if ([403, 429, 503].includes(status) && isChallenge(headers, body)) {
      throw new CaptureError('blocked', `The site answered ${status} with a bot challenge`);
    }
    throw new CaptureError('http-error', `The site answered ${status}`);
  }
}

/** Cloudflare and DataDome, the two that block headless Chromium most often (§8.3). */
export function isChallenge(headers: Record<string, string>, body: string): boolean {
  return (
    headers['cf-mitigated'] === 'challenge' ||
    'x-datadome' in headers ||
    /challenge-platform|cf-chl-|cf_chl_|captcha-delivery\.com|<title>Just a moment\.\.\.<\/title>/i.test(body)
  );
}

/** A page that is one colour, near enough: white, black, or a spinner's background. */
export async function isBlank(png: Buffer): Promise<boolean> {
  const { channels } = await sharp(png).stats();
  return channels.slice(0, 3).every((channel) => channel.stdev < 2);
}

function navigationFailure(error: unknown): CaptureError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof errors.TimeoutError) {
    return new CaptureError('timeout', `The page did not load within ${NAVIGATION_TIMEOUT_MS / 1000} s`);
  }
  return new CaptureError('unreachable', message.split('\n')[0].slice(0, 300));
}

async function userAgentOf(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    const agent = String(await page.evaluate('navigator.userAgent'));
    return agent.replace('HeadlessChrome/', 'Chrome/');
  } finally {
    await page.close();
  }
}
