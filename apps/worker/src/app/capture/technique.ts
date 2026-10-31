import {
  CaptureTechnique,
  CountedValue,
  CssTechnique,
  DesignTokens,
  ElementStyles,
} from '@moodboard/shared';
import { Page } from 'playwright';
import { analyseStylesheets } from './css-text';

/**
 * Technique extraction (§8.2 step 8, 0011 release 2): what the browser can measure, so nobody
 * has to guess it from the picture. Runs in context A after the scroll, when lazy content and
 * scroll reveals have happened.
 *
 * Two sources: the stylesheet text through CDP (`:hover` rules, `@keyframes`, `:root` custom
 * properties — the CSSOM cannot read cross-origin sheets), and computed styles of the visible
 * elements in the page (fonts, transitions, tokens, representative elements).
 */

export const TOP_TOKENS = 12;
export const MAX_CUSTOM_PROPERTIES = 200;
const MAX_STYLESHEETS = 60;
const MAX_STYLESHEET_CHARS = 3_000_000;

/** The computed-style half, as the in-page script returns it. */
interface PageMeasurement {
  readonly fonts: string[];
  readonly libraries: string[];
  readonly transition: CountedValue[];
  readonly animation: CountedValue[];
  readonly animationNames: string[];
  readonly transform: CountedValue[];
  readonly colors: CountedValue[];
  readonly radii: CountedValue[];
  readonly shadows: CountedValue[];
  readonly fontSizes: CountedValue[];
  readonly customProperties: { name: string; value: string }[];
  readonly elements: ElementStyles;
}

export async function extractTechnique(page: Page): Promise<CaptureTechnique> {
  const sheets = await stylesheetTexts(page);
  const found = analyseStylesheets(sheets);
  const measured = (await page.evaluate(
    MEASURE(found.rootProperties.slice(0, MAX_CUSTOM_PROPERTIES)),
  )) as PageMeasurement;

  const css: CssTechnique = {
    transition: measured.transition,
    animation: measured.animation,
    transform: measured.transform,
    hover: found.hover.slice(0, TOP_TOKENS),
    keyframes: measured.animationNames
      .filter((name) => found.keyframes.has(name))
      .slice(0, 6)
      .map((name) => ({ name, css: found.keyframes.get(name) ?? '' })),
  };
  const tokens: DesignTokens = {
    customProperties: measured.customProperties,
    colors: measured.colors,
    radii: measured.radii,
    shadows: measured.shadows,
    fontSizes: measured.fontSizes,
  };
  return {
    fonts: measured.fonts,
    libraries: measured.libraries,
    css,
    tokens,
    elements: measured.elements,
  };
}

/** The text of every author stylesheet of the main frame, inline and linked, any origin. */
async function stylesheetTexts(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const headers: Array<{
      styleSheetId: string;
      frameId: string;
      origin: string;
    }> = [];
    cdp.on('CSS.styleSheetAdded', ({ header }) => headers.push(header));
    const { frameTree } = await cdp.send('Page.getFrameTree');
    await cdp.send('DOM.enable');
    // Enabling reports every sheet already in the document as `styleSheetAdded`.
    await cdp.send('CSS.enable');

    const texts: string[] = [];
    let total = 0;
    for (const header of headers) {
      if (
        texts.length >= MAX_STYLESHEETS ||
        total >= MAX_STYLESHEET_CHARS ||
        header.origin !== 'regular' ||
        header.frameId !== frameTree.frame.id
      ) {
        continue;
      }
      const { text } = await cdp
        .send('CSS.getStyleSheetText', { styleSheetId: header.styleSheetId })
        .catch(() => ({ text: '' }));
      texts.push(text);
      total += text.length;
    }
    return texts;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/**
 * The in-page measurement. A string, because it runs in the page, not in Node — and coverage
 * instrumentation in tests would break a function handed to `evaluate`.
 */
const MEASURE = (rootProperties: string[]) => `(() => {
  const TOP = ${TOP_TOKENS};
  const vw = window.innerWidth;
  const counter = () => new Map();
  const add = (map, value) => { if (value) map.set(value, (map.get(value) || 0) + 1); };
  const top = (map, n = TOP) => [...map].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count).slice(0, n);
  const transparent = (c) => !c || c === 'transparent' || /rgba\\([^)]*,\\s*0\\)$/.test(c);
  const zero = (durations) => !durations || durations.split(',').every((d) => parseFloat(d) === 0);
  const firstFamily = (f) => f.split(',')[0].trim().replace(/^["']|["']$/g, '');

  // Visible elements: rendered, with a box, anywhere on the page (the scroll has run).
  const elements = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (elements.length >= 4000) break;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'BR'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    elements.push([el, s, r]);
  }
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  const families = counter(), transition = counter(), animation = counter(), animationNames = counter(),
    transform = counter(), colors = counter(), radii = counter(), shadows = counter(), fontSizes = counter();
  for (const [el, s] of elements) {
    const text = ownText(el);
    if (text) {
      add(families, firstFamily(s.fontFamily));
      add(fontSizes, s.fontSize);
      add(colors, s.color);
    }
    if (!transparent(s.backgroundColor)) add(colors, s.backgroundColor);
    if (s.borderRadius && s.borderRadius !== '0px') add(radii, s.borderRadius);
    if (s.boxShadow && s.boxShadow !== 'none') add(shadows, s.boxShadow);
    if (!zero(s.transitionDuration)) add(transition, s.transition);
    if (s.animationName && s.animationName !== 'none') {
      for (const name of s.animationName.split(',')) add(animationNames, name.trim());
      add(animation, [s.animationName, s.animationDuration, s.animationTimingFunction].join(' '));
    }
    if (s.transform && s.transform !== 'none') add(transform, s.transform);
  }

  // Fonts: what is in use on visible text, then what loaded besides.
  const fonts = top(families, 20).map((f) => f.value);
  try {
    for (const face of document.fonts) {
      if (face.status !== 'loaded') continue;
      const family = face.family.replace(/^["']|["']$/g, '');
      if (!fonts.includes(family)) fonts.push(family);
    }
  } catch {}

  // Libraries: globals, attributes and script URLs.
  const scripts = [...document.scripts].map((s) => s.src).join(' ') + ' ' +
    performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'script').map((e) => e.name).join(' ');
  const has = (selector) => { try { return !!document.querySelector(selector); } catch { return false; } };
  const html = document.documentElement;
  const libraries = [
    ['GSAP', !!window.gsap || !!window.TweenMax || /gsap|TweenMax/i.test(scripts)],
    ['ScrollTrigger', !!window.ScrollTrigger || /ScrollTrigger/i.test(scripts)],
    ['Lenis', !!window.Lenis || !!window.lenis || html.classList.contains('lenis') || /lenis/i.test(scripts)],
    ['AOS', !!window.AOS || has('[data-aos]')],
    ['Framer Motion', has('[data-framer-appear-id], [data-framer-name], [data-framer-component-type]') || /framer-motion|framerusercontent/i.test(scripts)],
    ['Swiper', !!window.Swiper || has('.swiper, .swiper-container') || /swiper/i.test(scripts)],
    ['Locomotive Scroll', !!window.LocomotiveScroll || has('[data-scroll-container]') || html.classList.contains('has-scroll-smooth') || /locomotive-scroll/i.test(scripts)],
  ].filter(([, found]) => found).map(([name]) => name);

  const root = getComputedStyle(html);
  const customProperties = ${JSON.stringify(rootProperties)}
    .map((name) => ({ name, value: root.getPropertyValue(name).trim() }))
    .filter((p) => p.value.length > 0 && p.value.length <= 200);

  // Representative elements.
  const style = (s) => {
    const out = {
      fontFamily: firstFamily(s.fontFamily),
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing === 'normal' ? undefined : s.letterSpacing,
      color: s.color,
      background: s.backgroundImage && s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url(')
        ? s.backgroundImage : transparent(s.backgroundColor) ? undefined : s.backgroundColor,
      borderRadius: s.borderRadius === '0px' ? undefined : s.borderRadius,
      boxShadow: s.boxShadow === 'none' ? undefined : s.boxShadow,
      padding: s.padding === '0px' ? undefined : s.padding,
      transition: zero(s.transitionDuration) ? undefined : s.transition,
    };
    for (const key of Object.keys(out)) if (!out[key]) delete out[key];
    return out;
  };
  const first = (predicate) => { const hit = elements.find(([el, s, r]) => predicate(el, s, r)); return hit ? style(hit[1]) : undefined; };
  const isButton = (el) => el.matches('button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"], a[class*="Button"]');
  const picked = {
    h1: first((el) => el.tagName === 'H1'),
    h2: first((el) => el.tagName === 'H2'),
    body: first((el) => el.tagName === 'P' && el.textContent.trim().length >= 40) || first((el) => ownText(el) && el.textContent.trim().length >= 40),
    button: first((el) => isButton(el) && el.textContent.trim().length > 0),
    link: first((el) => el.tagName === 'A' && !isButton(el) && el.textContent.trim().length > 0 && !!el.closest('p, li, main, article')),
  };
  // The most frequent card-like element: its own background plus a radius or a shadow, a size
  // between a chip and a section, grouped by tag and class.
  const cards = new Map();
  for (const [el, s, r] of elements) {
    if (transparent(s.backgroundColor) && s.backgroundImage === 'none') continue;
    if (s.borderRadius === '0px' && s.boxShadow === 'none') continue;
    if (r.width < 120 || r.height < 80 || r.width > vw * 0.8) continue;
    const key = el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\\s+/).sort().join('.') : '');
    const entry = cards.get(key) || { count: 0, s };
    entry.count++;
    cards.set(key, entry);
  }
  const card = [...cards.values()].sort((a, b) => b.count - a.count)[0];
  if (card) picked.card = style(card.s);
  for (const key of Object.keys(picked)) if (!picked[key]) delete picked[key];

  return {
    fonts: fonts.slice(0, 20),
    libraries,
    transition: top(transition),
    animation: top(animation),
    animationNames: top(animationNames, 20).map((a) => a.value),
    transform: top(transform),
    colors: top(colors),
    radii: top(radii),
    shadows: top(shadows),
    fontSizes: top(fontSizes),
    customProperties,
    elements: picked,
  };
})()`;
