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

describe('WebsiteCapturer', () => {
  let server: Server;
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
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

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
