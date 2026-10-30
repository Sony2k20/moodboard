import { Inject, Injectable } from '@nestjs/common';
import { assetFiles, assets, Database } from '@moodboard/db';
import {
  assetFilePath,
  CaptureFailure,
  isRetryableCaptureFailure,
  STORAGE_SERVICE,
  StorageService,
} from '@moodboard/shared';
import { UnrecoverableError } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { CaptureError, WebsiteCapturer } from '../capture/website-capturer';
import { DATABASE } from '../database.module';

export const WEBSITE_CAPTURER = Symbol('WEBSITE_CAPTURER');

/** A capture failure another attempt would not change; the asset ends `failed` with the reason. */
export class FinalCaptureError extends UnrecoverableError {
  constructor(
    readonly reason: CaptureFailure,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `capture` (§8.2, 0011), the first step for a website. It produces the two images every later
 * step works from: the poster (viewport, DPR 2), which thumbnails, colours and the model see, and
 * the full page as `original`, the archived record of the site as it was.
 *
 * Idempotent like the image steps: a retry replaces what an earlier attempt stored.
 */
@Injectable()
export class CaptureStep {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(WEBSITE_CAPTURER) private readonly capturer: WebsiteCapturer,
  ) {}

  async run(assetId: string): Promise<void> {
    const [asset] = await this.db
      .select({ sourceUrl: assets.sourceUrl })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset?.sourceUrl) {
      throw new UnrecoverableError(`Asset ${assetId} has no URL to capture`);
    }

    let result;
    try {
      result = await this.capturer.capture(asset.sourceUrl);
    } catch (error) {
      if (error instanceof CaptureError && !isRetryableCaptureFailure(error.reason)) {
        throw new FinalCaptureError(error.reason, error.message);
      }
      throw error;
    }

    const files = [
      {
        kind: 'poster' as const,
        path: assetFilePath(assetId, 'poster'),
        image: sharp(result.poster).webp({ quality: 90 }),
      },
      {
        kind: 'original' as const,
        path: assetFilePath(assetId, 'original', { extension: 'webp' }),
        image: sharp(result.fullPage).webp({ quality: 85 }),
      },
    ];
    const rows: Array<typeof assetFiles.$inferInsert> = [];
    for (const file of files) {
      const { data, info } = await file.image.toBuffer({ resolveWithObject: true });
      const stored = await this.storage.put(file.path, data, { mime: 'image/webp' });
      rows.push({
        assetId,
        kind: file.kind,
        path: file.path,
        mime: 'image/webp',
        width: info.width,
        height: info.height,
        bytes: stored.bytes,
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetFiles)
        .where(
          and(
            eq(assetFiles.assetId, assetId),
            inArray(
              assetFiles.kind,
              files.map((f) => f.kind),
            ),
          ),
        );
      await tx.insert(assetFiles).values(rows);
      await tx
        .update(assets)
        .set({ statusReason: null, updatedAt: new Date() })
        .where(eq(assets.id, assetId));
    });
  }
}
