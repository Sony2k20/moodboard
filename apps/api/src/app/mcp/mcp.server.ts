import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AssetQuerySchema,
  buildPrompt,
  MAX_UPLOAD_BYTES,
  parseCaptureUrl,
  sniffUploadFormat,
  STORAGE_SERVICE,
  StorageService,
} from '@moodboard/shared';
import { z } from 'zod';
import { AssetSearchService } from '../assets/asset-search.service';
import { AssetsService } from '../assets/assets.service';
import type { CurrentUser } from '../auth/users.service';

/** Read by the client once per connection; everything an agent must know before the first call. */
const INSTRUCTIONS = `A team's design memory: classified design references (screenshots, mockups) with a controlled facet vocabulary, colour palettes, descriptions and visual details.

Call list_vocabulary first: facet filters only accept its values, as "facet:value". Values within one facet are combined with OR, different facets, tags and the author with AND.
Values with origin "human" were set or confirmed by a person and outweigh the model's ("ai").
get_asset returns the reference image itself and a ready build prompt — look at the image before building from it.
For a captured website (type "website"), get_asset also returns captureTech: fonts, design tokens, element styles, transitions and hover rules measured on the live page. Those values are exact — prefer them over what the image suggests.`;

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
          'Facet filters plus full-text search, newest first. Returns cards (id, title, facets, tags) and, for every facet value, how many matching assets carry it — use the counts to narrow down. Page with nextCursor. Open a result with get_asset to see the image.',
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
          'One reference with all its metadata: facets with origin, description, visual details, palette, tags, and for a website the measured technique (captureTech). Also returns the image itself and a prompt for building a UI in its style.',
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
