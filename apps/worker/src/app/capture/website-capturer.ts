import { Logger } from '@nestjs/common';
import { CaptureFailure, CaptureTechnique, EMPTY_CSS_TECHNIQUE } from '@moodboard/shared';
import { Browser, BrowserContextOptions, chromium, errors, Page, Response } from 'playwright';
import sharp from 'sharp';
import { ConsentOutcome, dismissConsent, remainingOverlays } from './consent';
import { EgressProxy, REFUSED_HEADER, Resolver, resolvePublic } from './egress-guard';
import { recordScrollVideo } from './scroll-video';
import { extractTechnique } from './technique';

/** The viewport of every capture (§8.2): a common laptop, rendered at retina density. */
export const VIEWPORT = { width: 1440, height: 900 } as const;
export const DEVICE_SCALE_FACTOR = 2;

/** Taller pages are cut off in the full-page screenshot; WebP ends at 16,383 px (0011). */
export const MAX_FULL_PAGE_HEIGHT = 16_000;

const NAVIGATION_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_TIMEOUT_MS = 10_000;
/** The capture up to its pictures. Past this the browser is closed under the page. */
const CAPTURE_TIMEOUT_MS = 120_000;
/** The scroll video's own budget, on top: running out of it costs the video only (0011). */
const VIDEO_TIMEOUT_MS = 60_000;

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
  /** `1440x900@2`, as `capture_tech.viewport` records it. */
  readonly viewport: string;
  /** What the browser measured on the page (release 2). */
  readonly technique: CaptureTechnique;
  /** Which cookie-banner tier dismissed something, if any. */
  readonly consent: ConsentOutcome;
  /** The page scrolled top to bottom, H.264 MP4 at 1440×900 (release 3); `null` if it failed. */
  readonly video: Buffer | null;
}

export interface CapturerOptions {
  /** Record the scroll video. Off in tests that are about everything else, to save their time. */
  readonly video?: boolean;
}

/** What context B needs from context A to record the same page with the consent given. */
interface Recording {
  readonly context: BrowserContextOptions;
  readonly storageState: BrowserContextOptions['storageState'];
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
  constructor(
    private readonly resolve: Resolver = resolvePublic,
    private readonly options: CapturerOptions = { video: true },
  ) {}

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
      const { result, recording } = await Promise.race([work, deadline]);
      clearTimeout(timer);
      const video = this.options.video === false ? null : await this.video(browser, url, recording);
      return { ...result, video };
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

  /**
   * Context B (release 3): the scroll video, with its own budget. Whatever goes wrong costs the
   * video and is logged; the capture keeps its pictures and its measurement.
   */
  private async video(browser: Browser, url: string, recording: Recording): Promise<Buffer | null> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`took longer than ${VIDEO_TIMEOUT_MS / 1000} s`)),
        VIDEO_TIMEOUT_MS,
      );
    });
    const started = Date.now();
    const work = recordScrollVideo(browser, url, recording);
    try {
      const video = await Promise.race([work, deadline]);
      this.logger.log(
        `Recorded ${url}: ${Math.round(video.byteLength / 1024)} KiB in ${Math.round((Date.now() - started) / 1000)} s`,
      );
      return video;
    } catch (error) {
      this.logger.warn(`No scroll video for ${url}: ${String(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
      // Abandoned on a timeout; closing the browser afterwards ends it.
      work.catch(() => undefined);
    }
  }

  private async run(
    browser: Browser,
    url: string,
    proxy: EgressProxy,
  ): Promise<{ result: Omit<CaptureResult, 'video'>; recording: Recording }> {
    const options: BrowserContextOptions = {
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      locale: 'en-US',
      // "HeadlessChrome" in the user agent is the cheapest bot signal there is. This is not a
      // stealth plugin (out of scope for 0011), only the browser naming itself like Chrome does.
      userAgent: await userAgentOf(browser),
      acceptDownloads: false,
    };
    const context = await browser.newContext(options);

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
    // A banner over the page spoils both the picture and the measurement, so it goes first.
    const consent = await dismissConsent(page).catch(() => null);
    const overlays = await remainingOverlays(page).catch(() => []);
    if (overlays.length > 0) {
      this.logger.warn(
        `An overlay still covers ${new URL(page.url()).host} after the consent tiers ` +
          `(${consent ?? 'none'}): ${overlays.join(', ')}`,
      );
    }
    await page.evaluate(SCROLL_THROUGH);
    // A measurement that fails costs the technique, not the picture.
    const technique = await extractTechnique(page).catch((error: unknown): CaptureTechnique => {
      this.logger.warn(`Technique extraction failed for ${url}: ${String(error)}`);
      return { fonts: [], libraries: [], css: EMPTY_CSS_TECHNIQUE, tokens: null, elements: null };
    });

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
    const storageState = await context.storageState();
    // Context A's job is done; closing it before B opens keeps one page in memory, not two.
    await context.close();

    return {
      result: {
        poster,
        fullPage,
        pageTitle,
        viewport: `${VIEWPORT.width}x${VIEWPORT.height}@${DEVICE_SCALE_FACTOR}`,
        technique,
        consent,
      },
      recording: { context: options, storageState },
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
