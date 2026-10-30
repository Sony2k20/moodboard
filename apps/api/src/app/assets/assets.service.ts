import { Inject, Injectable, Logger } from '@nestjs/common';
import { assetFiles, assets, auditLog, Database } from '@moodboard/db';
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
 * Names nobody chose as a title: what browsers call a pasted image (`image.png`), and a file
 * named after its own format (`jpg`), which some download dialogs produce.
 */
const GENERIC_NAMES = new Set([
  'image',
  'blob',
  'clipboard',
  'untitled',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
]);

export function titleFromFileName(name: string | undefined): string | null {
  const stem = (name ?? '').replace(/\.[^.]*$/, '').trim();
  if (!stem || GENERIC_NAMES.has(stem.toLowerCase())) {
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
    userId: string;
  }): Promise<{ id: string; enqueued: boolean }> {
    const id = randomUUID();
    const { mime, extension } = UPLOAD_FORMATS[input.format];
    const path = assetFilePath(id, 'original', { extension });
    const stored = await this.storage.put(path, input.bytes, { mime });

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(assets).values({
          id,
          type: 'image',
          title: titleFromFileName(input.fileName),
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
          diff: { source: 'upload', format: input.format, bytes: stored.bytes },
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
}
