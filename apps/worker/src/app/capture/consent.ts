import { Frame, Page } from 'playwright';

/**
 * Cookie banners (§8.3, 0011 release 2), the most common cause of a useless capture. Three tiers,
 * each tried only when the one before found nothing:
 *
 * 1. the accept button of a known consent-management platform, by selector
 * 2. a button named like "Accept all" or "Alle akzeptieren", in the page and its iframes
 * 3. removing fixed or sticky elements that cover much of the viewport and talk about consent
 *
 * Accept, not reject: the capture should look like the page a visitor sees after clicking
 * through, and a rejection often swaps embedded media for "content blocked". The browser
 * context is thrown away afterwards, so the consent goes nowhere.
 */
export type ConsentOutcome = 'platform' | 'button' | 'removed' | null;

/** Accept-all buttons of the platforms the doc names. Playwright's CSS pierces open shadow roots. */
export const PLATFORM_ACCEPT_SELECTORS = [
  '#onetrust-accept-btn-handler', // OneTrust
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot
  '#CybotCookiebotDialogBodyButtonAccept',
  '[data-testid="uc-accept-all-button"]', // Usercentrics
  '#didomi-notice-agree-button', // Didomi
  '.qc-cmp2-summary-buttons button[mode="primary"]', // Quantcast
  '#truste-consent-button', // TrustArc
  'a[data-cookie-accept-all]', // Borlabs 2
  '.brlbs-btn-accept-all', // Borlabs 3
  '.cmplz-btn.cmplz-accept', // Complianz
];

/** Whole accessible names only: "Accept" alone matches, "Accept and pay" does not. */
export const ACCEPT_BUTTON_NAME =
  /^\s*(accept( all( cookies)?| cookies)?|allow( all( cookies)?| cookies)?|i agree|agree( to all)?|got it|ok(ay)?|alle (cookies )?akzeptieren|akzeptieren|alle (cookies )?zulassen|zustimmen|allen zustimmen|einverstanden|ich stimme zu|verstanden)\s*[.!]?\s*$/i;

/** The share of the viewport a fixed element must cover to count as an overlay. */
export const COVER_SHARE = 0.3;

const CLICK_TIMEOUT_MS = 2000;
const SETTLE_MS = 600;

export async function dismissConsent(page: Page): Promise<ConsentOutcome> {
  if (
    await clickFirstVisible(
      page.mainFrame(),
      PLATFORM_ACCEPT_SELECTORS.join(', '),
    )
  ) {
    await page.waitForTimeout(SETTLE_MS);
    return 'platform';
  }
  for (const frame of page.frames()) {
    if (await clickAcceptButton(frame)) {
      await page.waitForTimeout(SETTLE_MS);
      return 'button';
    }
  }
  const removed = Number(
    await page.evaluate(removeConsentOverlays(COVER_SHARE)),
  );
  return removed > 0 ? 'removed' : null;
}

/**
 * Fixed or sticky elements still covering at least `COVER_SHARE` of the viewport after the
 * tiers ran, described briefly — logged with the host, so the heuristic improves from real misses.
 */
export async function remainingOverlays(page: Page): Promise<string[]> {
  return (await page.evaluate(describeOverlays(COVER_SHARE))) as string[];
}

async function clickFirstVisible(
  frame: Frame,
  selector: string,
): Promise<boolean> {
  const candidates = frame.locator(selector);
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate
        .click({ timeout: CLICK_TIMEOUT_MS, noWaitAfter: true })
        .then(
          () => true,
          () => false,
        );
    }
  }
  return false;
}

async function clickAcceptButton(frame: Frame): Promise<boolean> {
  const buttons = frame.getByRole('button', { name: ACCEPT_BUTTON_NAME });
  const count = Math.min(await buttons.count().catch(() => 0), 10);
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      return button
        .click({ timeout: CLICK_TIMEOUT_MS, noWaitAfter: true })
        .then(
          () => true,
          () => false,
        );
    }
  }
  return false;
}

/**
 * The in-page part of both tier 3 and the check afterwards. A string, because it runs in the
 * page, not in Node (and test coverage instrumentation would break a function).
 */
const OVERLAYS = (share: number) => `
  const viewport = window.innerWidth * window.innerHeight;
  const covering = [];
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const r = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
    const height = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    if (width * height < viewport * ${share}) continue;
    if (covering.some((outer) => outer.contains(element))) continue;
    covering.push(element);
  }
`;

const CONSENT_WORDS =
  /cookie|consent|privacy|gdpr|datenschutz|einwillig|zustimm/i;

function removeConsentOverlays(share: number): string {
  return `(() => {
    ${OVERLAYS(share)}
    let removed = 0;
    for (const element of covering) {
      if (!${CONSENT_WORDS}.test(element.textContent || '')) continue;
      element.remove();
      removed++;
    }
    if (removed > 0) {
      // Banners lock scrolling while they are open; the scroll and the full page need it back.
      for (const root of [document.documentElement, document.body]) {
        if (root && getComputedStyle(root).overflow === 'hidden') root.style.setProperty('overflow', 'visible', 'important');
      }
    }
    return removed;
  })()`;
}

function describeOverlays(share: number): string {
  return `(() => {
    ${OVERLAYS(share)}
    return covering.map((element) => {
      const id = element.id ? '#' + element.id : '';
      const cls = typeof element.className === 'string' && element.className.trim()
        ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.')
        : '';
      return (element.tagName.toLowerCase() + id + cls).slice(0, 120);
    });
  })()`;
}
