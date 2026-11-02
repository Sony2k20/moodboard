import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assetFacetDecisions,
  assetFacetValues,
  assetFiles,
  assetFonts,
  assets,
  auditLog,
  componentCode,
  Database,
  facets,
  facetValues,
} from '@moodboard/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  assetFilePath,
  ComponentCode,
  FONT_FORMATS,
  FontFormat,
  STORAGE_SERVICE,
  StorageService,
  UPLOAD_FORMATS,
  UploadFormat,
} from '@moodboard/shared';
import { randomUUID } from 'node:crypto';
import { DATABASE } from '../database.module';
import { readFont } from './font-reader';
import { PipelineQueue } from './pipeline.queue';

/**
 * Names nobody chose (0007). Each pattern runs against the stem with a trailing counter like
 * ` (3)` or `-2` removed. What matches is left to the model to name.
 */
const MACHINE_NAMES: readonly RegExp[] = [
  // What browsers call a pasted image, a file named after its own format, and the names of our
  // own stored files (`original.jpg`, `thumb-lg.webp`), which come back through the download link.
  /^(image|img|blob|clipboard|untitled|unbenannt|download|file|photo|picture|bild|png|jpe?g|webp|gif|original|thumb-(sm|md|lg))$/i,
  // Screenshot tools on macOS, Windows, GNOME, KDE and their German variants.
  /^(screen ?shot|bildschirmfoto|bildschirmaufnahme|capture|snip(aste)?|screenshot_?\d)/i,
  // Cameras, phones and messengers.
  /^(img|dsc|dscn|pxl|mvimg|photo|whatsapp image|signal|telegram|pexels|unsplash)[ _-]?\d/i,
  // UUIDs and hashes.
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-z_-]{20,}$/i,
];

const TRAILING_COUNTER = /(\s*\(\d+\)|[-_ ]\d{1,3})$/;

/**
 * A title only for a file name a person evidently chose (0004, sharpened in 0007). A screenshot
 * name, a camera name or a hash is not a title; the model names those assets instead.
 */
export function titleFromFileName(name: string | undefined): string | null {
  const stem = (name ?? '').replace(/\.[^.]*$/, '').trim();
  const bare = stem.replace(TRAILING_COUNTER, '').trim();
  const letters = (bare.match(/\p{L}/gu) ?? []).length;
  const digits = (bare.match(/\d/g) ?? []).length;
  if (
    letters < 3 ||
    digits > letters ||
    MACHINE_NAMES.some((pattern) => pattern.test(bare))
  ) {
    return null;
  }
  return stem.slice(0, 200);
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Records `type` as the person's decision: they handed in a URL or a font file, so what the
 * asset is is not the model's to guess, and the facet guard keeps it through every re-analysis
 * (0006, 0011, 0017).
 */
async function decideType(tx: Tx, assetId: string, value: string, userId: string): Promise<void> {
  const [type] = await tx
    .select({ facetId: facets.id, valueId: facetValues.id })
    .from(facetValues)
    .innerJoin(facets, eq(facets.id, facetValues.facetId))
    .where(and(eq(facets.key, 'type'), eq(facetValues.value, value)))
    .limit(1);
  if (type) {
    await tx.insert(assetFacetValues).values({
      assetId,
      facetValueId: type.valueId,
      origin: 'human',
      setBy: userId,
    });
    await tx.insert(assetFacetDecisions).values({ assetId, facetId: type.facetId, decidedBy: userId });
  }
}

/**
 * Ingest lives here rather than in the controller, so MCP `add_asset` can call the same path
 * later (0004).
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly queue: PipelineQueue,
  ) {}

  /**
   * Stores the original byte-exact (0004, decision 1), records the asset as `pending` and starts
   * the pipeline. The file is written first: a row without its file would be a broken asset,
   * a file without its row is only an orphan that the next cleanup can remove.
   */
  async ingestUpload(input: {
    bytes: Uint8Array;
    format: UploadFormat;
    fileName?: string;
    /** Where it came from, for the audit log: the web upload or MCP `add_asset` (0010). */
    source?: 'upload' | 'mcp';
    /** A title the person gave explicitly (MCP `add_asset`, 0010); wins over the file name. */
    title?: string;
    userId: string;
  }): Promise<{ id: string; enqueued: boolean }> {
    const id = randomUUID();
    const { mime, extension } = UPLOAD_FORMATS[input.format];
    const path = assetFilePath(id, 'original', { extension });
    const stored = await this.storage.put(path, input.bytes, { mime });

    const title = input.title?.trim().slice(0, 200) || titleFromFileName(input.fileName);
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(assets).values({
          id,
          type: 'image',
          title,
          // A chosen file name is a person's title; without one the model names the asset.
          titleOrigin: title ? 'human' : 'ai',
          createdBy: input.userId,
          status: 'pending',
        });
        await tx.insert(assetFiles).values({
          assetId: id,
          kind: 'original',
          path,
          mime,
          bytes: stored.bytes,
        });
        await tx.insert(auditLog).values({
          userId: input.userId,
          action: 'asset.created',
          entity: 'asset',
          entityId: id,
          diff: { source: input.source ?? 'upload', format: input.format, bytes: stored.bytes },
        });
      });
    } catch (error) {
      await this.storage.delete(path).catch(() => undefined);
      throw error;
    }

    const enqueued = await this.queue.startPipeline(id);
    if (!enqueued) {
      this.logger.warn(
        `Asset ${id} stored, but the queue is unreachable; the reconciler will pick it up`,
      );
    }
    return { id, enqueued };
  }

  /**
   * A font file (0017). Parsed here, before anything is stored: a file the font library cannot
   * read is refused at once (`UnreadableFontError`). What the file says goes to `asset_font`; its
   * full name is the title, as a fact the model never renames. The worker draws the specimen.
   */
  async ingestFont(input: {
    bytes: Uint8Array;
    format: FontFormat;
    source?: 'upload' | 'mcp';
    userId: string;
  }): Promise<{ id: string; enqueued: boolean }> {
    const meta = readFont(Buffer.from(input.bytes));
    const id = randomUUID();
    const { mime, extension } = FONT_FORMATS[input.format];
    const path = assetFilePath(id, 'original', { extension });
    const stored = await this.storage.put(path, input.bytes, { mime });

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(assets).values({
          id,
          type: 'font',
          title: (meta.fullName ?? meta.family).slice(0, 200),
          titleOrigin: 'human',
          createdBy: input.userId,
          status: 'pending',
        });
        await tx.insert(assetFiles).values({ assetId: id, kind: 'original', path, mime, bytes: stored.bytes });
        await tx.insert(assetFonts).values({
          assetId: id,
          ...meta,
          axes: [...meta.axes],
          features: [...meta.features],
        });
        await decideType(tx, id, 'font', input.userId);
        await tx.insert(auditLog).values({
          userId: input.userId,
          action: 'asset.created',
          entity: 'asset',
          entityId: id,
          diff: { source: input.source ?? 'upload', format: input.format, bytes: stored.bytes, family: meta.family },
        });
      });
    } catch (error) {
      await this.storage.delete(path).catch(() => undefined);
      throw error;
    }

    const enqueued = await this.queue.startPipeline(id, 'font');
    if (!enqueued) {
      this.logger.warn(`Font ${id} stored, but the queue is unreachable; the reconciler will pick it up`);
    }
    return { id, enqueued };
  }

  /**
   * A component from its code (0018). The code is the asset; the worker renders it into the
   * picture. `type: component` is the person's decision, a given title theirs too.
   */
  async ingestComponent(input: {
    code: ComponentCode;
    title?: string;
    userId: string;
  }): Promise<{ id: string; enqueued: boolean }> {
    const id = randomUUID();
    const title = input.title?.trim().slice(0, 200) || null;
    await this.db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id,
        type: 'component',
        title,
        titleOrigin: title ? 'human' : 'ai',
        createdBy: input.userId,
        status: 'pending',
      });
      await tx.insert(componentCode).values({ assetId: id, ...input.code, updatedBy: input.userId });
      await decideType(tx, id, 'component', input.userId);
      await tx.insert(auditLog).values({
        userId: input.userId,
        action: 'asset.created',
        entity: 'asset',
        entityId: id,
        diff: { source: 'component', chars: input.code.html.length + input.code.css.length + input.code.js.length },
      });
    });
    const enqueued = await this.queue.startPipeline(id, 'component');
    if (!enqueued) {
      this.logger.warn(`Component ${id} recorded, but the queue is unreachable; the reconciler will pick it up`);
    }
    return { id, enqueued };
  }

  /**
   * A new version of a component's code (0018), by anyone — editing is open (§9). The previous
   * code goes to the audit log; the pipeline renders and classifies again, and the guards keep
   * what people set on the facets (§5.6). `false` when the asset is no live component.
   */
  async updateComponent(id: string, code: ComponentCode, userId: string): Promise<boolean> {
    const updated = await this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ html: componentCode.html, css: componentCode.css, js: componentCode.js, width: componentCode.width })
        .from(componentCode)
        .innerJoin(assets, eq(assets.id, componentCode.assetId))
        .where(and(eq(componentCode.assetId, id), isNull(assets.deletedAt)))
        .limit(1);
      if (!previous) {
        return false;
      }
      await tx
        .update(componentCode)
        .set({ ...code, updatedBy: userId, updatedAt: new Date() })
        .where(eq(componentCode.assetId, id));
      await tx.update(assets).set({ updatedAt: new Date() }).where(eq(assets.id, id));
      await tx.insert(auditLog).values({
        userId,
        action: 'component.updated',
        entity: 'asset',
        entityId: id,
        diff: { before: previous },
      });
      return true;
    });
    if (updated) {
      await this.queue.startPipeline(id, 'component');
    }
    return updated;
  }

  /**
   * A website to capture (0011). Nothing is fetched here — the worker does that, behind its
   * egress guard — so this only records the asset and starts the pipeline at `capture`.
   *
   * `type: website` goes in as the person's decision (`decideType`): a screenshot of a website
   * would otherwise easily come back as `image`.
   */
  async ingestUrl(input: {
    url: string;
    source?: 'upload' | 'mcp';
    title?: string;
    userId: string;
  }): Promise<{ id: string; enqueued: boolean }> {
    const id = randomUUID();
    const title = input.title?.trim().slice(0, 200) || null;
    await this.db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id,
        type: 'website',
        title,
        titleOrigin: title ? 'human' : 'ai',
        sourceUrl: input.url,
        createdBy: input.userId,
        status: 'pending',
      });
      await decideType(tx, id, 'website', input.userId);
      await tx.insert(auditLog).values({
        userId: input.userId,
        action: 'asset.created',
        entity: 'asset',
        entityId: id,
        diff: { source: input.source ?? 'upload', url: input.url },
      });
    });

    const enqueued = await this.queue.startPipeline(id, 'website');
    if (!enqueued) {
      this.logger.warn(
        `Asset ${id} recorded, but the queue is unreachable; the reconciler will pick it up`,
      );
    }
    return { id, enqueued };
  }

  /**
   * Another attempt at a website whose capture failed (0011). Only for a failed website: anything
   * else either has nothing to capture or is already on its way.
   */
  async retryCapture(assetId: string, userId: string): Promise<boolean> {
    const [asset] = await this.db
      .update(assets)
      .set({ status: 'pending', statusReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.type, 'website'),
          eq(assets.status, 'failed'),
          isNull(assets.deletedAt),
        ),
      )
      .returning({ id: assets.id });
    if (!asset) {
      return false;
    }
    await this.db.insert(auditLog).values({
      userId,
      action: 'asset.capture_retried',
      entity: 'asset',
      entityId: assetId,
    });
    await this.queue.startPipeline(assetId, 'website');
    return true;
  }
}
