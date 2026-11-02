import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { ComponentRenderer } from './component-renderer';

/**
 * A component's code rendered in a real Chromium (0018): the picture is the content at the chosen
 * width, and the document's own policy keeps the code from sending anything anywhere.
 */
describe('ComponentRenderer', () => {
  let server: Server;
  let base: string;
  let hits = 0;
  // Loopback is allowed here only so a leak would reach the test server and be counted.
  const renderer = new ComponentRenderer(async (host) => (host === '127.0.0.1' ? host : 'forbidden'));

  beforeAll(async () => {
    server = createServer((_, response) => {
      hits += 1;
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('renders the content at the chosen width, at DPR 2, as tall as it is', async () => {
    const png = await renderer.render({
      html: '<div class="box"></div>',
      css: '.box { width: 200px; height: 300px; background: rgb(255, 0, 0); }',
      js: '',
      width: 390,
    });
    const { width, height } = await sharp(png).metadata();
    expect(width).toBe(390 * 2);
    // 300 px box plus the body's padding of 32 px above and below.
    expect(height).toBe((300 + 64) * 2);
    const { data } = await sharp(png).extract({ left: 100, top: 100, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
  }, 60_000);

  it('runs inline script, but no request leaves the document', async () => {
    hits = 0;
    const png = await renderer.render({
      html: '<p id="out">waiting</p><img src="' + base + '/pixel.png">',
      css: `@import url("${base}/style.css"); #out { font-size: 40px; }`,
      js: `document.getElementById('out').textContent = 'ran';
        fetch('${base}/leak').catch(() => {});
        navigator.sendBeacon && navigator.sendBeacon('${base}/beacon', 'x');
        const s = document.createElement('script'); s.src = '${base}/script.js'; document.body.append(s);`,
      width: 768,
    });
    expect(png.length).toBeGreaterThan(0);
    expect(hits).toBe(0);
  }, 60_000);
});
