import { createServer, Server } from 'node:http';
import { AddressInfo, connect } from 'node:net';
import { EgressProxy, isForbiddenAddress, resolvePublic } from './egress-guard';

describe('isForbiddenAddress', () => {
  it('refuses loopback, private, link-local and the like', () => {
    for (const address of [
      '127.0.0.1',
      '10.43.0.10',
      '172.20.1.1',
      '192.168.1.20',
      '169.254.169.254',
      '100.100.1.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:c0a8:101',
      '64:ff9b::a00:1',
      'not an address',
    ]) {
      expect([address, isForbiddenAddress(address)]).toEqual([address, true]);
    }
  });

  it('lets public addresses through', () => {
    for (const address of ['93.184.215.14', '1.1.1.1', '::ffff:1.1.1.1', '2606:4700:4700::1111']) {
      expect([address, isForbiddenAddress(address)]).toEqual([address, false]);
    }
  });
});

describe('resolvePublic', () => {
  it('refuses internal names without asking DNS', async () => {
    for (const host of ['localhost', 'printer.local', 'valkey.prod.svc', 'db.prod.svc.cluster.local', 'x.internal']) {
      await expect(resolvePublic(host)).resolves.toBe('forbidden');
    }
  });

  it('judges literal addresses, bracketed IPv6 included', async () => {
    await expect(resolvePublic('10.0.0.1')).resolves.toBe('forbidden');
    await expect(resolvePublic('[::1]')).resolves.toBe('forbidden');
    await expect(resolvePublic('1.1.1.1')).resolves.toBe('1.1.1.1');
  });
});

describe('EgressProxy CONNECT', () => {
  let target: Server;
  let port: number;
  let proxy: EgressProxy;
  let proxyPort: number;

  beforeAll(async () => {
    target = createServer((_req, res) => res.end('inside'));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    port = (target.address() as AddressInfo).port;
    // As in the capturer test: 127.0.0.1 plays the internet, localhost the cluster.
    proxy = new EgressProxy(async (host) => (host === '127.0.0.1' ? host : 'forbidden'));
    proxyPort = Number(new URL(await proxy.start()).port);
  });

  afterAll(async () => {
    await proxy.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  /** The first line the proxy answers a CONNECT with, then whatever comes through the tunnel. */
  const tunnel = (authority: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(proxyPort, '127.0.0.1', () => {
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      });
      let received = '';
      socket.on('data', (chunk) => {
        received += chunk.toString();
        if (received.startsWith('HTTP/1.1 200') && !received.includes('GET-SENT')) {
          received += 'GET-SENT';
          socket.write(`GET / HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`);
        }
      });
      socket.on('end', () => resolve(received));
      socket.on('error', reject);
    });

  it('tunnels to an allowed host', async () => {
    const answer = await tunnel(`127.0.0.1:${port}`);
    expect(answer).toMatch(/^HTTP\/1\.1 200 Connection Established/);
    expect(answer).toContain('inside');
  });

  it('refuses a forbidden host, and remembers it', async () => {
    const answer = await tunnel(`localhost:${port}`);
    expect(answer).toMatch(/^HTTP\/1\.1 403/);
    expect(answer).not.toContain('inside');
    expect(proxy.refused.has('localhost')).toBe(true);
  });

  it('refuses a malformed authority', async () => {
    await expect(tunnel('no-port')).resolves.toMatch(/^HTTP\/1\.1 502/);
  });
});
