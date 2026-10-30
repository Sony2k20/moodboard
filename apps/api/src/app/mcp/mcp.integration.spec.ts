import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  Body,
  Controller,
  ExecutionContext,
  HttpCode,
  INestApplication,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
  assetFacetValues,
  assetFiles,
  assets,
  Database,
  facets,
  facetValues,
  schema,
  seedVocabulary,
  users,
} from '@moodboard/db';
import { StorageService } from '@moodboard/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AssetSearchService } from '../assets/asset-search.service';
import { AssetsService } from '../assets/assets.service';
import { ApiTokensService } from '../auth/api-tokens.service';
import { CurrentUser, UsersService } from '../auth/users.service';
import { configureBodyParsers } from '../body-parsers';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp.server';

/**
 * The MCP server (0010) against a real Postgres, through a real MCP client: what an agent sees
 * is what this asserts.
 */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const THUMB = Buffer.from('fake webp bytes');

let client: PGlite;
let db: Database;
let ada: CurrentUser;
let bob: CurrentUser;
let leaf: string;
const ingestUpload = jest.fn(async () => ({ id: 'new-asset', enqueued: true }));

const storage = {
  url: (path: string) => `/files/${path}`,
  get: async () =>
    (async function* () {
      yield THUMB;
    })(),
} as unknown as StorageService;

async function connect(user: CurrentUser): Promise<Client> {
  const factory = new McpServerFactory(
    new AssetSearchService(db, storage),
    { ingestUpload } as unknown as AssetsService,
    storage,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await factory.create(user).connect(serverSide);
  const mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(clientSide);
  return mcp;
}

const textOf = (result: unknown) =>
  ((result as { content: Array<{ type: string; text?: string }> }).content)
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  await seedVocabulary(db);

  const rows = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
    ])
    .returning();
  [ada, bob] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    locale: u.locale,
  }));

  [{ id: leaf }] = await db
    .insert(assets)
    .values({
      type: 'image',
      title: 'Leaf landing page',
      description: 'Photographed leaves over a textured green background.',
      createdBy: ada.id,
      status: 'ready',
    })
    .returning({ id: assets.id });
  for (const key of ['imagery:photography', 'finish:soft-shadow', 'theme:dark']) {
    const [facet, value] = key.split(':');
    const [fv] = await db
      .select({ id: facetValues.id })
      .from(facetValues)
      .innerJoin(facets, eq(facets.id, facetValues.facetId))
      .where(and(eq(facets.key, facet), eq(facetValues.value, value)));
    await db.insert(assetFacetValues).values({ assetId: leaf, facetValueId: fv.id, origin: 'ai' });
  }
  await db.insert(assetFiles).values({
    assetId: leaf,
    kind: 'thumb_lg',
    path: `${leaf}/thumb-lg.webp`,
    mime: 'image/webp',
    bytes: THUMB.length,
  });
}, 60_000);

afterAll(() => client.close());

describe('API tokens', () => {
  const tokens = () => new ApiTokensService(db, new UsersService(db));

  it('authenticates a token as its owner, lists it without the token, and stops after revocation', async () => {
    const { token, item } = await tokens().create(ada, 'Claude Code, laptop');
    expect(token).toMatch(/^mb_[A-Za-z0-9_-]{43}$/);
    expect(item.prefix).toBe(token.slice(0, 9));

    expect((await tokens().authenticate(token))?.id).toBe(ada.id);
    const listed = await tokens().list(ada);
    expect(listed.map((t) => t.name)).toEqual(['Claude Code, laptop']);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0].lastUsedAt).not.toBeNull();

    await expect(tokens().revoke(bob, item.id)).rejects.toBeInstanceOf(NotFoundException);
    await tokens().revoke(ada, item.id);
    expect(await tokens().authenticate(token)).toBeNull();
    expect(await tokens().list(ada)).toEqual([]);
  });

  it('refuses what is not a token of ours', async () => {
    expect(await tokens().authenticate('mb_nonsense')).toBeNull();
    expect(await tokens().authenticate('ghp_somebody_elses')).toBeNull();
  });
});

describe('MCP over HTTP', () => {
  /**
   * The path a real client takes: Nest controller, bearer guard, the larger body limit and the
   * stateless transport — the same wiring as main.ts and AuthModule, with the token check reduced
   * to one known token.
   */
  let app: INestApplication;
  let url: URL;

  beforeAll(async () => {
    const tokenOwner = ada;
    const module = await Test.createTestingModule({
      controllers: [McpController, EchoController],
      providers: [
        {
          provide: McpServerFactory,
          useValue: new McpServerFactory(
            new AssetSearchService(db, storage),
            { ingestUpload } as unknown as AssetsService,
            storage,
          ),
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: ExecutionContext) => {
              const req = ctx.switchToHttp().getRequest();
              if (
                req.method === 'POST' &&
                req.path.endsWith('/mcp') &&
                req.headers.authorization !== 'Bearer mb_test'
              ) {
                throw new UnauthorizedException();
              }
              req.user = tokenOwner;
              return true;
            },
          },
        },
      ],
    }).compile();
    // The same wiring as main.ts — what broke every other route's body in 0.7.0.
    app = module.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix('api');
    configureBodyParsers(app, 'api');
    await app.listen(0);
    url = new URL(`${await app.getUrl()}/api/mcp`.replace('[::1]', 'localhost'));
  });

  afterAll(() => app.close());

  it('serves the tools to a streamable HTTP client with a bearer token', async () => {
    const mcp = new Client({ name: 'http-test', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer mb_test' } },
      }),
    );
    const found = JSON.parse(
      textOf(
        await mcp.callTool({
          name: 'search_assets',
          arguments: { facet: ['imagery:photography'] },
        }),
      ),
    );
    expect(found.items[0].id).toBe(leaf);
    await mcp.close();
  });

  it('takes an image larger than the default 100 kB body limit', async () => {
    const mcp = new Client({ name: 'http-test', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer mb_test' } },
      }),
    );
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const added = await mcp.callTool({
      name: 'add_asset',
      arguments: { image_base64: big.toString('base64') },
    });
    expect(added.isError).toBeFalsy();
    await mcp.close();
  });

  it('refuses a request without a token', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('answers GET with 405: no server-initiated stream in stateless mode', async () => {
    expect((await fetch(url)).status).toBe(405);
  });

  it('still parses JSON and form bodies on every other route, with the small limit', async () => {
    const echo = new URL('/api/echo', url);
    const asJson = await fetch(echo, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'probe' }),
    });
    expect(await asJson.json()).toEqual({ name: 'probe' });

    const asForm = await fetch(echo, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'logout_token=abc',
    });
    expect(await asForm.json()).toEqual({ logout_token: 'abc' });

    const tooLarge = await fetch(echo, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(200 * 1024) }),
    });
    expect(tooLarge.status).toBe(413);
  });
});

@Controller('echo')
class EchoController {
  @Post()
  @HttpCode(200)
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('MCP tools', () => {
  it('offers the four tools of phase 1', async () => {
    const mcp = await connect(ada);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_asset',
      'get_asset',
      'list_vocabulary',
      'search_assets',
    ]);
    expect(mcp.getInstructions()).toContain('list_vocabulary first');
  });

  it('lists the vocabulary with the combination rule', async () => {
    const mcp = await connect(ada);
    const body = JSON.parse(textOf(await mcp.callTool({ name: 'list_vocabulary', arguments: {} })));
    expect(body.rule).toContain('OR');
    expect(body.facets.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining(['style', 'imagery', 'finish']),
    );
  });

  it('searches with the same filters as the web', async () => {
    const mcp = await connect(ada);
    const found = JSON.parse(
      textOf(
        await mcp.callTool({
          name: 'search_assets',
          arguments: { facet: ['imagery:photography', 'finish:soft-shadow'] },
        }),
      ),
    );
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({ id: leaf, title: 'Leaf landing page', author: 'Ada' });
    expect(found.counts).toContain('theme:dark=1');
  });

  it('answers a bad filter with an error, not an empty result', async () => {
    const mcp = await connect(ada);
    for (const facet of [['photography'], ['imagery:sketch']]) {
      const result = await mcp.callTool({ name: 'search_assets', arguments: { facet } });
      expect(result.isError).toBe(true);
    }
  });

  it('returns one asset with the image and the build prompt', async () => {
    const mcp = await connect(ada);
    const result = await mcp.callTool({ name: 'get_asset', arguments: { id: leaf } });
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(textOf(result)).toContain('"title": "Leaf landing page"');
    expect(textOf(result)).toContain('use photographs too');
    expect(textOf(result)).toContain('Build prompt:');
    const image = content.find((c) => c.type === 'image');
    expect(image).toMatchObject({ mimeType: 'image/webp', data: THUMB.toString('base64') });

    const missing = await mcp.callTool({
      name: 'get_asset',
      arguments: { id: '6f1c9a0e-2b7d-4c1a-9a51-0d2f3e4b5c6d' },
    });
    expect(missing.isError).toBe(true);
  });

  it('adds an image under the token owner’s name, and refuses what is not an image', async () => {
    const mcp = await connect(bob);
    const added = await mcp.callTool({
      name: 'add_asset',
      arguments: { image_base64: PNG.toString('base64'), title: 'Pricing page, Linear' },
    });
    expect(JSON.parse(textOf(added))).toMatchObject({ id: 'new-asset', status: 'pending' });
    expect(ingestUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'png',
        title: 'Pricing page, Linear',
        source: 'mcp',
        userId: bob.id,
      }),
    );

    const refused = await mcp.callTool({
      name: 'add_asset',
      arguments: { image_base64: Buffer.from('<svg/>').toString('base64') },
    });
    expect(refused.isError).toBe(true);
  });
});
