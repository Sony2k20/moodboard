import { lookup } from 'node:dns/promises';
import {
  createServer,
  IncomingMessage,
  request as httpRequest,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo, BlockList, connect, isIP, Socket } from 'node:net';
import { Duplex } from 'node:stream';

/**
 * Where a capture may not go (0011). The worker runs inside the cluster, next to the database,
 * Valkey and whatever else the LAN holds; a URL must not turn the browser into a way in.
 */
const FORBIDDEN = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT, also Tailscale
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  FORBIDDEN.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  // IPv4-mapped addresses (::ffff:a.b.c.d) are unpacked and judged as IPv4 below. A rule for
  // ::ffff:0:0/96 here would match every IPv4 address too: BlockList checks IPv4 against it.
  ['64:ff9b::', 96], // NAT64: would smuggle any IPv4 address past the list above
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  FORBIDDEN.addSubnet(network, prefix, 'ipv6');
}

export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  const mapped = family === 6 ? unmapIPv4(address) : null;
  if (mapped) {
    return isForbiddenAddress(mapped);
  }
  return FORBIDDEN.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * `::ffff:10.0.0.1`, `::ffff:a00:1` and `0:0:0:0:0:ffff:a00:1` all to `10.0.0.1`; `null` for any
 * other IPv6. The URL parser brings every spelling into the one form `::ffff:hhhh:hhhh`.
 */
function unmapIPv4(address: string): string | null {
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!hex) {
    return null;
  }
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Names that resolve elsewhere than public DNS says, or only exist inside the cluster. */
const FORBIDDEN_NAMES = /(^|\.)(localhost|local|internal|svc|cluster\.local)$/;

/**
 * The address to connect to for a host, or `forbidden`. A name must not look internal, and every
 * address it resolves to must be public — one private answer among public ones is enough to
 * refuse, since the connection could land on either. A name that does not resolve throws, so the
 * caller can report it as unreachable rather than forbidden.
 */
export type Resolver = (hostname: string) => Promise<string | 'forbidden'>;

export const resolvePublic: Resolver = async (hostname) => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (FORBIDDEN_NAMES.test(host)) {
    return 'forbidden';
  }
  if (isIP(host)) {
    return isForbiddenAddress(host) ? 'forbidden' : host;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenAddress(address))) {
    return 'forbidden';
  }
  return addresses[0].address;
};

/** Set on the proxy's own refusals, so a refused document is told apart from a site's 403. */
export const REFUSED_HEADER = 'x-moodboard-refused';

/**
 * The egress guard (0011): a forward proxy on loopback that every connection of the capture
 * browser goes through. It resolves each host itself, refuses non-public ones, and connects to
 * exactly the address it checked.
 *
 * A proxy rather than Playwright's `route`, because `route` sees only the first request of a
 * redirect chain — a public URL answering `302 Location: http://10.0.0.5/` would get past it —
 * and nothing of a WebSocket's handshake. And because the proxy connects to the address it
 * checked, a DNS answer that changes between check and connect (rebinding) has nowhere to go.
 * The egress NetworkPolicy in the chart remains as the layer below, for what Chromium might do
 * outside its proxy settings.
 */
export class EgressProxy {
  /** Hosts refused during this capture, for the log and for telling the reason. */
  readonly refused = new Set<string>();
  private readonly server: Server;
  private readonly sockets = new Set<Duplex>();

  constructor(private readonly resolve: Resolver = resolvePublic) {
    this.server = createServer((req, res) => void this.onRequest(req, res));
    this.server.on('connect', (req: IncomingMessage, socket: Duplex, head: Buffer) =>
      void this.onConnect(req, socket, head),
    );
    // Chromium tunnels WebSockets through CONNECT; a bare upgrade has no business here.
    this.server.on('upgrade', (_req, socket: Duplex) => socket.destroy());
    this.server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  /** Listens on an ephemeral loopback port; answers the proxy URL for the browser. */
  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** `CONNECT host:port` — https and every WebSocket. TLS stays end to end. */
  private async onConnect(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    this.track(client);
    const target = splitHostPort(req.url ?? '');
    const address = target ? await this.check(target.host) : 'unresolved';
    if (!target || address === 'forbidden' || address === 'unresolved') {
      client.end(`HTTP/1.1 ${address === 'forbidden' ? '403 Forbidden' : '502 Bad Gateway'}\r\n\r\n`);
      return;
    }
    const upstream = connect(target.port, address, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(client);
      client.pipe(upstream);
    });
    this.track(upstream);
    upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    client.on('error', () => upstream.destroy());
  }

  /** Plain http: the browser sends the absolute URL, the proxy makes the request. */
  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const address = url.protocol === 'http:' ? await this.check(url.hostname) : 'forbidden';
    if (address === 'forbidden' || address === 'unresolved') {
      res
        .writeHead(address === 'forbidden' ? 403 : 502, { [REFUSED_HEADER]: address })
        .end();
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = httpRequest(
      {
        host: address,
        port: url.port || 80,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        setHost: false,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { [REFUSED_HEADER]: 'unresolved' });
      }
      res.end();
    });
    req.pipe(upstream);
  }

  private async check(host: string): Promise<string | 'forbidden' | 'unresolved'> {
    try {
      const address = await this.resolve(host);
      if (address === 'forbidden') {
        this.refused.add(host);
      }
      return address;
    } catch {
      return 'unresolved';
    }
  }

  private track(socket: Duplex): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
  }
}

function splitHostPort(authority: string): { host: string; port: number } | null {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(authority);
  const port = match ? Number(match[2]) : NaN;
  return match && port > 0 && port < 65536 ? { host: match[1], port } : null;
}
