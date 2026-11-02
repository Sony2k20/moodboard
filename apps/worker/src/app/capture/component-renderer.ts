import { ComponentCode, componentDocument } from '@moodboard/shared';
import { chromium } from 'playwright';
import { DEVICE_SCALE_FACTOR } from './website-capturer';
import { EgressProxy, Resolver, resolvePublic } from './egress-guard';

const VIEWPORT_HEIGHT = 900;
/** Taller renderings are cut off; a component is not a page. */
const MAX_HEIGHT = 4000;
const LOAD_TIMEOUT_MS = 15_000;
/** Lets entrance transitions and web fonts settle before the picture is taken. */
const SETTLE_MS = 800;
const RENDER_TIMEOUT_MS = 45_000;

/**
 * Renders a component's code (0018) in the same document the browser preview runs: the page's
 * own policy blocks every request it may not make, and what it may make goes through the egress
 * guard, like a website capture (0011). One browser per render, so nothing carries over.
 *
 * The picture is the rendered content, not the viewport: the body's height at the chosen width,
 * at DPR 2, at most `MAX_HEIGHT` tall.
 */
export class ComponentRenderer {
  /** `resolve` is replaceable for tests only, which have nothing but loopback to serve from. */
  constructor(private readonly resolve: Resolver = resolvePublic) {}

  async render(code: ComponentCode): Promise<Buffer> {
    const proxy = new EgressProxy(this.resolve);
    const browser = await chromium.launch({
      headless: true,
      proxy: { server: await proxy.start() },
    });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`The render took longer than ${RENDER_TIMEOUT_MS / 1000} s`));
        void browser.close().catch(() => undefined);
      }, RENDER_TIMEOUT_MS);
    });
    const work = (async () => {
      const context = await browser.newContext({
        viewport: { width: code.width, height: VIEWPORT_HEIGHT },
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        // The code may want to download or open things; nothing it does leaves the page.
        acceptDownloads: false,
      });
      const page = await context.newPage();
      await page.setContent(componentDocument(code), {
        waitUntil: 'load',
        timeout: LOAD_TIMEOUT_MS,
      });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_MS);
      const height = await page.evaluate(
        // The body, not the document: a short component would otherwise be as tall as the viewport.
        `Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height))`,
      );
      return page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: code.width, height: Math.min(Math.max(Number(height), 120), MAX_HEIGHT) },
        fullPage: true,
      });
    })();
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      work.catch(() => undefined);
      await browser.close().catch(() => undefined);
      await proxy.close();
    }
  }
}
