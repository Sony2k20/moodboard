import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { CaptureError, WebsiteCapturer } from './website-capturer';

/**
 * Real Chromium against a local server. The test has only loopback to serve from, so the guard
 * is told that `127.0.0.1` stands for the public internet and `localhost` for the inside of the
 * cluster — the same address under two names, which is exactly what a redirect or a page
 * resource would use to get past a check made only once.
 */
const PAGE = `<!doctype html><html><head><title>Capture test</title>
<style>body{margin:0;font-family:sans-serif}section{height:900px;display:grid;place-items:center}
section:nth-child(odd){background:#1d3557;color:#fff}section:nth-child(even){background:#f1faee}</style>
</head><body><section><h1>Hero</h1></section><section>Two</section><section>Three</section></body></html>`;

/** A banner over the lower half of the page, in a red no page section has. */
const BANNER_STYLE = 'position:fixed;left:0;right:0;bottom:0;height:450px;background:rgb(255,0,0);z-index:10';
const ONETRUST = `${PAGE}<div id="onetrust-banner-sdk" style="${BANNER_STYLE}">We use cookies.
<button id="onetrust-accept-btn-handler" onclick="this.parentNode.remove()">Accept</button></div>`;
const IFRAME_BANNER = `${PAGE}<iframe id="cmp" style="${BANNER_STYLE};border:0" srcdoc="<button onclick=&quot;parent.document.getElementById('cmp').remove()&quot;>Alle akzeptieren</button>"></iframe>`;
const NO_BUTTON = `${PAGE}<div style="${BANNER_STYLE}">Diese Seite verwendet Cookies. Mit der Nutzung stimmen Sie der Datenschutzerklärung zu.</div>`;

/** Served from a second origin, which the CSSOM could not read and CDP can. */
const CROSS_ORIGIN_CSS = `:root { --accent: #ff4f00; --radius: 16px }
.card { width: 300px; height: 200px; margin: 20px; background: #fff; border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,.2); transition: transform .6s cubic-bezier(.16,1,.3,1) }
.card:hover { transform: translateY(-4px) }
@keyframes rise { from { opacity: 0 } to { opacity: 1 } }
h1 { font-size: 64px; animation: rise .8s ease-out both }
.button { display: inline-block; padding: 12px 24px; border-radius: 999px; background: #111; color: #fff }`;
const TECHNIQUE = (cssOrigin: string) => `<!doctype html><html><head><title>Technique</title>
<link rel="stylesheet" href="${cssOrigin}/site.css"><script>window.gsap = { version: '3' }</script></head>
<body style="margin:0;font-family:sans-serif;background:#f1faee"><h1>Studio</h1>
<p>A paragraph long enough to count as body text on this fixture page, with a <a href="/">link</a>.</p>
<a class="button" href="/">Get started</a><div class="card">One</div><div class="card">Two</div></body></html>`;

describe('WebsiteCapturer', () => {
  let server: Server;
  let cssServer: Server;
  let base: string;
  let internalHits: string[];
  const capturer = new WebsiteCapturer(async (host) =>
    host === '127.0.0.1' ? host : 'forbidden',
  );

  beforeEach(() => {
    internalHits = [];
  });

  beforeAll(async () => {
    internalHits = [];
    server = createServer((request, response) => {
      if (request.headers.host?.startsWith('localhost')) {
        internalHits.push(request.url ?? '');
      }
      switch (request.url) {
        case '/':
          response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
          break;
        case '/consent-platform':
          response.writeHead(200, { 'content-type': 'text/html' }).end(ONETRUST);
          break;
        case '/consent-iframe':
          response.writeHead(200, { 'content-type': 'text/html' }).end(IFRAME_BANNER);
          break;
        case '/consent-no-button':
          response.writeHead(200, { 'content-type': 'text/html' }).end(NO_BUTTON);
          break;
        case '/technique': {
          const cssPort = (cssServer.address() as AddressInfo).port;
          response
            .writeHead(200, { 'content-type': 'text/html' })
            .end(TECHNIQUE(`http://127.0.0.1:${cssPort}`));
          break;
        }
        case '/blank':
          response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body></body>');
          break;
        case '/challenge':
          response
            .writeHead(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' })
            .end('<!doctype html><title>Just a moment...</title>');
          break;
        case '/gone':
          response.writeHead(410, { 'content-type': 'text/html' }).end('<h1>Gone</h1>');
          break;
        case '/redirect-inside': {
          const port = (server.address() as AddressInfo).port;
          response.writeHead(302, { location: `http://localhost:${port}/secret` }).end();
          break;
        }
        case '/redirect-outside':
          response.writeHead(302, { location: '/' }).end();
          break;
        case '/leaky': {
          const port = (server.address() as AddressInfo).port;
          response
            .writeHead(200, { 'content-type': 'text/html' })
            .end(`${PAGE}<img src="http://localhost:${port}/secret.png">`);
          break;
        }
        default:
          response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cssServer = createServer((_, response) => {
      response.writeHead(200, { 'content-type': 'text/css' }).end(CROSS_ORIGIN_CSS);
    });
    await new Promise<void>((resolve) => cssServer.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => cssServer.close(() => resolve()));
  });

  /** Whether the poster still shows the red banner, sampled in the lower half. */
  const showsBanner = async (poster: Buffer) => {
    const { data } = await sharp(poster)
      .extract({ left: 100, top: 1500, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data[0] > 200 && data[1] < 50 && data[2] < 50;
  };

  const reasonOf = (url: string) =>
    capturer.capture(url).then(
      () => 'captured',
      (error: unknown) => (error instanceof CaptureError ? error.reason : String(error)),
    );

  it('takes a poster at DPR 2 and the full page at DPR 1', async () => {
    const result = await capturer.capture(`${base}/`);
    const poster = await sharp(result.poster).metadata();
    const full = await sharp(result.fullPage).metadata();
    expect([poster.width, poster.height]).toEqual([2880, 1800]);
    expect([full.width, full.height]).toEqual([1440, 2700]);
    expect(result.pageTitle).toBe('Capture test');
    expect(result.viewport).toBe('1440x900@2');
  }, 60_000);

  it('accepts a known consent platform before taking the poster', async () => {
    const result = await capturer.capture(`${base}/consent-platform`);
    expect(result.consent).toBe('platform');
    expect(await showsBanner(result.poster)).toBe(false);
  }, 60_000);

  it('clicks an accept button by its name, inside an iframe too', async () => {
    const result = await capturer.capture(`${base}/consent-iframe`);
    expect(result.consent).toBe('button');
    expect(await showsBanner(result.poster)).toBe(false);
  }, 60_000);

  it('removes a consent overlay without a button as the last resort', async () => {
    const result = await capturer.capture(`${base}/consent-no-button`);
    expect(result.consent).toBe('removed');
    expect(await showsBanner(result.poster)).toBe(false);
  }, 60_000);

  it('leaves a page without a banner alone', async () => {
    const result = await capturer.capture(`${base}/`);
    expect(result.consent).toBeNull();
  }, 60_000);

  it('measures the technique, cross-origin stylesheets included', async () => {
    const { technique } = await capturer.capture(`${base}/technique`);
    expect(technique.libraries).toEqual(['GSAP']);
    expect(technique.fonts.length).toBeGreaterThan(0);
    expect(technique.css.hover).toEqual([{ value: 'transform: translateY(-4px)', count: 1 }]);
    expect(technique.css.transition[0]).toEqual({
      value: 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      count: 2,
    });
    expect(technique.css.animation[0].value).toBe('rise 0.8s ease-out');
    expect(technique.css.keyframes).toEqual([{ name: 'rise', css: '{from{opacity:0}to{opacity:1}}' }]);
    expect(technique.tokens?.customProperties).toEqual([
      { name: '--accent', value: '#ff4f00' },
      { name: '--radius', value: '16px' },
    ]);
    expect(technique.tokens?.radii.map((r) => r.value)).toEqual(['16px', '999px']);
    expect(technique.elements?.h1?.fontSize).toBe('64px');
    expect(technique.elements?.button).toMatchObject({ borderRadius: '999px', padding: '12px 24px' });
    expect(technique.elements?.card).toMatchObject({
      borderRadius: '16px',
      boxShadow: 'rgba(0, 0, 0, 0.2) 0px 8px 24px 0px',
    });
    expect(technique.elements?.body?.fontFamily).toBeTruthy();
    expect(technique.elements?.link).toBeDefined();
  }, 60_000);

  it('follows a redirect that stays outside', async () => {
    await expect(reasonOf(`${base}/redirect-outside`)).resolves.toBe('captured');
  }, 60_000);

  it('refuses a forbidden host before starting a browser', async () => {
    await expect(reasonOf('http://localhost:1/')).resolves.toBe('forbidden-target');
  });

  it('refuses a redirect into the inside, without the inside ever being asked', async () => {
    await expect(reasonOf(`${base}/redirect-inside`)).resolves.toBe('forbidden-target');
    expect(internalHits).toEqual([]);
  }, 60_000);

  it('captures a page but drops its requests to the inside', async () => {
    await expect(reasonOf(`${base}/leaky`)).resolves.toBe('captured');
    expect(internalHits).toEqual([]);
  }, 60_000);

  it('reports a challenge as blocked and other errors as http-error', async () => {
    await expect(reasonOf(`${base}/challenge`)).resolves.toBe('blocked');
    await expect(reasonOf(`${base}/gone`)).resolves.toBe('http-error');
  }, 60_000);

  it('reports a page of one colour as blank instead of storing it', async () => {
    await expect(reasonOf(`${base}/blank`)).resolves.toBe('blank');
  }, 60_000);

  it('reports a host that does not answer as unreachable', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(reasonOf(`http://127.0.0.1:${port}/`)).resolves.toBe('unreachable');
  }, 60_000);
});
