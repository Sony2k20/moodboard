import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AssetDetail,
  AssetQuerySchema,
  BoardDetail,
  buildPrompt,
  MAX_UPLOAD_BYTES,
  parseCaptureUrl,
  sniffUploadFormat,
  STORAGE_SERVICE,
  StorageService,
  TOKEN_FORMATS,
} from '@moodboard/shared';
import { z } from 'zod';
import { AssetSearchService } from '../assets/asset-search.service';
import { AssetsService } from '../assets/assets.service';
import { BoardsService } from '../boards/boards.service';
import type { CurrentUser } from '../auth/users.service';

/** Read by the client once per connection; everything an agent must know before the first call. */
const INSTRUCTIONS = `A team's design memory: classified design references (screenshots, mockups) with a controlled facet vocabulary, colour palettes, descriptions and visual details.

Call list_vocabulary first: facet filters only accept its values, as "facet:value". Values within one facet are combined with OR, different facets, tags and the author with AND.
Values with origin "human" were set or confirmed by a person and outweigh the model's ("ai").
get_asset returns the reference image itself and a ready build prompt — look at the image before building from it.
For a captured website (type "website"), get_asset also returns captureTech: fonts, design tokens, element styles, transitions and hover rules measured on the live page. Those values are exact — prefer them over what the image suggests.
For a font (type "font"), the image is a specimen drawn from the uploaded file, and get_asset returns font: family, style, weight, variable axes, OpenType features, designer and licence as the file states them. The original file is the font itself — use its family name in font-family, and respect its licence.
For a component (type "component"), get_asset returns component: the HTML, CSS and JavaScript it is made of. The code is the reference — the image is only its rendering, and hover states, transitions and animations exist only in the code. Build from the code.
A board (list_boards, get_board) is a briefing package a person curated for one purpose — when asked to work from a board, work from get_board rather than searching. Each item has a role, the aspect of the reference that is meant (color, layout, typography, motion, imagery, copy or overall), and a weight: primary and secondary items are wanted, avoid items are counter-examples. Take from a reference only what its role names. derived is computed on the server: palette, type pairings, motion, the facets every primary item shares, and conflicts within the board. Do not average a conflict — ask the person which way to go.`;

/** Pictures `get_board` sends at most; the rest are listed with their URLs. */
const MAX_BOARD_IMAGES = 12;

const text = (value: unknown): CallToolResult => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

const failure = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

/**
 * The MCP server (0010, §10). One instance per request — the transport is stateless — bound to
 * the token's owner. Every tool is a thin layer over a service the web uses too, so an agent and
 * a person with the same filter see the same result.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly search: AssetSearchService,
    private readonly assets: AssetsService,
    private readonly boards: BoardsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  create(user: CurrentUser): McpServer {
    const server = new McpServer(
      { name: 'moodboard', version: '1' },
      { instructions: INSTRUCTIONS },
    );

    server.registerTool(
      'list_vocabulary',
      {
        title: 'List the facet vocabulary',
        description:
          'The controlled vocabulary: every facet with its values, English labels and descriptions. Filter values for search_assets must come from here — anything else is rejected.',
        annotations: { readOnlyHint: true },
      },
      async () => {
        const vocabulary = await this.search.vocabulary();
        return text({
          rule: 'Values within one facet: OR. Different facets, tags and author: AND. Filter as "facet:value".',
          facets: vocabulary.map((facet) => ({
            key: facet.key,
            multiValue: facet.isMultiValue,
            label: facet.label.en,
            description: facet.description?.en ?? null,
            values: facet.values.map((v) => ({ value: v.value, label: v.label.en })),
          })),
        });
      },
    );

    server.registerTool(
      'search_assets',
      {
        title: 'Search design references',
        description:
          'Facet filters plus full-text search, newest first. Returns cards (id, title, facets, tags, unconfirmedFacets) and, for every facet value, how many matching assets carry it — use the counts to narrow down. unconfirmedFacets is how many facets still hold only a model\'s guess; 0 means a person has confirmed or corrected every facet a model filled, so prefer those references when quality matters. Page with nextCursor. Open a result with get_asset to see the image.',
        inputSchema: {
          facet: z
            .array(z.string())
            .optional()
            .describe('Facet filters as "facet:value", e.g. ["style:editorial", "theme:dark"]'),
          q: z.string().optional().describe('Full-text search over titles and descriptions (English), or an exact tag'),
          tag: z.array(z.string()).optional().describe('Exact tag names, all required'),
          author: z.string().optional().describe('A user id'),
          cursor: z.string().optional().describe('nextCursor from the previous page'),
          limit: z.number().int().min(1).max(100).optional().describe('Page size, default 20'),
        },
        annotations: { readOnlyHint: true },
      },
      async (input) => {
        const parsed = AssetQuerySchema.safeParse({ ...input, limit: input.limit ?? 20 });
        if (!parsed.success) {
          return failure(z.prettifyError(parsed.error));
        }
        try {
          const result = await this.search.search(parsed.data);
          return text({
            total: result.total,
            nextCursor: result.nextCursor,
            items: result.items.map((item) => ({
              id: item.id,
              title: item.title,
              status: item.status,
              classified: item.classified,
              author: item.author.displayName,
              createdAt: item.createdAt,
              facets: item.facets.map((f) => `${f.facet}:${f.value}`),
              tags: item.tags,
              unconfirmedFacets: item.unconfirmedFacets,
            })),
            counts: result.counts.facets
              .filter((c) => c.count > 0)
              .map((c) => `${c.facet}:${c.value}=${c.count}`),
          });
        } catch (error) {
          if (error instanceof BadRequestException) {
            return failure(error.message);
          }
          throw error;
        }
      },
    );

    server.registerTool(
      'get_asset',
      {
        title: 'Get one design reference',
        description:
          'One reference with all its metadata: facets with origin and confidence, description, visual details, palette, tags, and for a website the measured technique (captureTech). A facet value with origin "human" was set or confirmed by a person; with origin "ai" it is a model\'s guess, and confidence (0 to 1) is how sure the model was of that facet — treat a guess below 0.7 with care. Also returns the image itself and a prompt for building a UI in its style.',
        inputSchema: { id: z.uuid().describe('The asset id from search_assets') },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => {
        const asset = await this.search.detail(id);
        if (!asset) {
          return failure(`No asset ${id} — it does not exist or is in the trash`);
        }
        const vocabulary = await this.search.vocabulary();
        const { files, ...metadata } = asset;
        const result: CallToolResult = {
          content: [
            { type: 'text', text: JSON.stringify(metadata, null, 2) },
            { type: 'text', text: `Build prompt:\n\n${buildPrompt(asset, vocabulary)}` },
          ],
        };
        // thumb-lg, not the original: up to 1600 px is enough to see, and costs far less context.
        const image = files.find((f) => f.kind === 'thumb_lg') ?? files.find((f) => f.kind === 'thumb_md');
        if (image) {
          const path = image.url.replace(/^\/files\//, '');
          result.content.push({
            type: 'image',
            data: Buffer.from(await this.read(path)).toString('base64'),
            mimeType: image.mime,
          });
        }
        return result;
      },
    );

    server.registerTool(
      'add_asset',
      {
        title: 'Add a design reference',
        description:
          'Adds a design reference under your name: either an image (PNG, JPEG, WebP or GIF, base64, at most 25 MB) or the URL of a website, which is then captured — screenshot of the viewport and of the full page. Pass exactly one of the two. An image is classified within about a minute, a website within about two; get_asset then shows the result, or why a capture failed. Without a title the model names it.',
        inputSchema: {
          image_base64: z
            .string()
            .min(1)
            .optional()
            .describe('The image file, base64-encoded, without a data: prefix'),
          url: z
            .string()
            .optional()
            .describe('An http or https URL of a public website to capture'),
          title: z.string().max(200).optional().describe('A title, if you have a meaningful one'),
        },
      },
      async ({ image_base64, url, title }) => {
        if (Boolean(image_base64) === Boolean(url)) {
          return failure('Pass exactly one of image_base64 and url');
        }
        if (url) {
          const parsed = parseCaptureUrl(url);
          if (!parsed) {
            return failure('url must be an http or https URL with a host name');
          }
          const { id } = await this.assets.ingestUrl({
            url: parsed,
            title,
            source: 'mcp',
            userId: user.id,
          });
          return text({
            id,
            status: 'pending',
            note: 'The capture and classification take up to two minutes; call get_asset afterwards. A capture can fail — get_asset then shows status "failed" and a statusReason.',
          });
        }
        const bytes = Buffer.from(image_base64 ?? '', 'base64');
        if (bytes.length === 0) {
          return failure('image_base64 is empty or not base64');
        }
        if (bytes.length > MAX_UPLOAD_BYTES) {
          return failure('The image is larger than 25 MB');
        }
        const format = sniffUploadFormat(bytes);
        if (!format) {
          return failure('Only PNG, JPEG, WebP and GIF images are accepted');
        }
        const { id } = await this.assets.ingestUpload({
          bytes,
          format,
          title,
          source: 'mcp',
          userId: user.id,
        });
        return text({
          id,
          status: 'pending',
          note: 'Classification takes up to a minute; call get_asset afterwards.',
        });
      },
    );

    server.registerTool(
      'list_boards',
      {
        title: 'List the boards',
        description:
          'Every board: a curated set of references for one purpose, with a written briefing. Manual boards are curated item by item; smart boards are a saved filter whose items are always its current result. Open one with get_board.',
        annotations: { readOnlyHint: true },
      },
      async () =>
        text(
          (await this.boards.list()).map((b) => ({
            id: b.id,
            title: b.title,
            kind: b.kind,
            items: b.itemCount,
            briefing: b.briefing.length > 200 ? `${b.briefing.slice(0, 200)}…` : b.briefing,
            author: b.author.displayName,
            updatedAt: b.updatedAt,
          })),
        ),
    );

    server.registerTool(
      'get_board',
      {
        title: 'Get a board as a briefing',
        description:
          "A board as a finished briefing: title, briefing, the items with role, weight, note and the asset's metadata, derived values computed on the server (palette, typePairings, motionSummary, commonFacets, conflicts), design tokens in four formats, a briefing prompt, and the pictures of up to twelve items — primary first, then avoid, then secondary. Call get_asset for an item's full detail, measured technique or code.",
        inputSchema: { id: z.uuid().describe('The board id from list_boards') },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => {
        const board = await this.boards.detail(id);
        if (!board) {
          return failure(`No board ${id}`);
        }
        const result: CallToolResult = {
          content: [
            { type: 'text', text: JSON.stringify(briefing(board), null, 2) },
            { type: 'text', text: `Briefing prompt:\n\n${board.prompt}` },
          ],
        };
        const order = { primary: 0, avoid: 1, secondary: 2 } as const;
        const shown = board.items
          .map((item, i) => ({ item, position: i + 1 }))
          .sort((a, b) => order[a.item.weight] - order[b.item.weight] || a.position - b.position)
          .slice(0, MAX_BOARD_IMAGES);
        for (const { item, position } of shown) {
          // thumb-md, not thumb-lg: up to twelve pictures in one answer.
          const image = item.asset.files.find((f) => f.kind === 'thumb_md');
          if (!image) {
            continue;
          }
          result.content.push(
            {
              type: 'text',
              text: `Item ${position}: ${item.role}, ${item.weight} — ${item.asset.title ?? 'untitled'} (${item.asset.id})`,
            },
            {
              type: 'image',
              data: Buffer.from(await this.read(image.url.replace(/^\/files\//, ''))).toString('base64'),
              mimeType: image.mime,
            },
          );
        }
        return result;
      },
    );

    server.registerTool(
      'get_design_tokens',
      {
        title: 'Get design tokens',
        description:
          'Palette, fonts, radii, shadows, font sizes and motion of a board — or of a single asset — as design tokens: plain JSON (json), W3C design tokens (w3c), CSS custom properties (css) or a Tailwind v4 @theme fragment (tailwind). Values come from the stored palette and the measured technique; one that no item has is left out, never invented.',
        inputSchema: {
          board_id: z.uuid().optional().describe('A board id from list_boards'),
          asset_id: z.uuid().optional().describe('An asset id, instead of a board'),
          format: z.enum([...TOKEN_FORMATS, 'all']).optional().describe('Default: all'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ board_id, asset_id, format }) => {
        if (Boolean(board_id) === Boolean(asset_id)) {
          return failure('Pass exactly one of board_id and asset_id');
        }
        const tokens = board_id
          ? (await this.boards.detail(board_id))?.tokens
          : await this.boards.assetTokens(asset_id as string);
        if (!tokens) {
          return failure(
            board_id ? `No board ${board_id}` : `No asset ${asset_id} — it does not exist or is in the trash`,
          );
        }
        const chosen = format ?? 'all';
        return text(chosen === 'all' ? tokens : tokens[chosen]);
      },
    );

    return server;
  }

  private async read(path: string): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of await this.storage.get(path)) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

/** A board in the shape of concept §10.1: the briefing first, each asset reduced to what briefs. */
function briefing(board: BoardDetail) {
  const file = (asset: AssetDetail, kind: string) =>
    asset.files.find((f) => f.kind === kind)?.url ?? null;
  return {
    id: board.id,
    title: board.title,
    kind: board.kind,
    briefing: board.briefing,
    filter: board.filter,
    items: board.items.map((item, i) => ({
      position: i + 1,
      role: item.role,
      weight: item.weight,
      note: item.note,
      asset: {
        id: item.asset.id,
        title: item.asset.title,
        type: item.asset.type,
        facets: item.asset.facets,
        colors: item.asset.colors,
        description: item.asset.description,
        image_url: file(item.asset, 'thumb_lg') ?? file(item.asset, 'thumb_md'),
        capture_url: file(item.asset, 'capture'),
        capture_tech: item.asset.captureTech,
        font: item.asset.font,
        component: item.asset.component,
      },
    })),
    derived: board.derived,
    tokens: board.tokens,
  };
}
