import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assetFacetDecisions,
  assetFacetValues,
  assetFiles,
  assets,
  auditLog,
  Database,
  facets,
  facetValues,
} from '@moodboard/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  assetFilePath,
  STORAGE_SERVICE,
  StorageService,
  UPLOAD_FORMATS,
  UploadFormat,
} from '@moodboard/shared';
import { randomUUID } from 'node:crypto';
import { DATABASE } from '../database.module';
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
   * A website to capture (0011). Nothing is fetched here — the worker does that, behind its
   * egress guard — so this only records the asset and starts the pipeline at `capture`.
   *
   * `type: website` goes in as the person's decision: they handed in a URL, so what the asset is
   * is not the model's to guess. A screenshot of a website would otherwise easily come back as
   * `image`, and the facet guard keeps a decided facet through every re-analysis (0006).
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
      const [type] = await tx
        .select({ facetId: facets.id, valueId: facetValues.id })
        .from(facetValues)
        .innerJoin(facets, eq(facets.id, facetValues.facetId))
        .where(and(eq(facets.key, 'type'), eq(facetValues.value, 'website')))
        .limit(1);
      if (type) {
        await tx.insert(assetFacetValues).values({
          assetId: id,
          facetValueId: type.valueId,
          origin: 'human',
          setBy: input.userId,
        });
        await tx
          .insert(assetFacetDecisions)
          .values({ assetId: id, facetId: type.facetId, decidedBy: input.userId });
      }
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
