import { Inject, Injectable } from '@nestjs/common';
import { assetFiles, assets, Database } from '@moodboard/db';
import { assetFilePath, STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import { UnrecoverableError } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { DATABASE } from '../database.module';
import { ImageSteps } from './image.steps';
import { SPECIMEN_HEIGHT, SPECIMEN_WIDTH, specimenSvg } from './specimen';

/**
 * `specimen` (0017), the first step for a font. It draws the picture every later step works
 * from — thumbnails, colours and the model read the `poster`, as for a website — while the font
 * file stays the `original`. The api has parsed the file already; a font that fails here anyway
 * fails the asset.
 *
 * Idempotent: a retry replaces the poster an earlier attempt stored.
 */
@Injectable()
export class SpecimenStep {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly images: ImageSteps,
  ) {}

  async run(assetId: string): Promise<void> {
    const [asset] = await this.db
      .select({ title: assets.title })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new UnrecoverableError(`Asset ${assetId} does not exist`);
    }
    const { bytes } = await this.images.original(assetId);

    let png: Buffer;
    try {
      const font = fontkit.create(bytes);
      if ('fonts' in font) {
        throw new Error('a font collection');
      }
      const svg = specimenSvg(font, asset.title || font.familyName);
      png = await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (error) {
      throw new UnrecoverableError(`No specimen for ${assetId}: ${String(error)}`);
    }

    const path = assetFilePath(assetId, 'poster');
    const webp = await sharp(png).webp({ quality: 90 }).toBuffer();
    const stored = await this.storage.put(path, webp, { mime: 'image/webp' });
    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetFiles)
        .where(and(eq(assetFiles.assetId, assetId), eq(assetFiles.kind, 'poster')));
      await tx.insert(assetFiles).values({
        assetId,
        kind: 'poster',
        path,
        mime: 'image/webp',
        width: SPECIMEN_WIDTH,
        height: SPECIMEN_HEIGHT,
        bytes: stored.bytes,
      });
    });
  }
}
