import { Inject, Injectable } from '@nestjs/common';
import { assetColors, assetFiles, assets, Database } from '@moodboard/db';
import {
  AssetFileKind,
  assetFilePath,
  STORAGE_SERVICE,
  StorageService,
  THUMBNAIL_WIDTHS,
} from '@moodboard/shared';
import { UnrecoverableError } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { DATABASE } from '../database.module';
import { extractPalette } from './palette';

const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif']);

/** Reads a stored object fully. Originals are at most 25 MB (0004). */
export async function readAll(
  storage: StorageService,
  path: string,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await storage.get(path)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * `normalize`, `thumbnails` and `colors` (§7.1, 0004). Every step is idempotent — it replaces
 * what an earlier run of itself wrote — because the reconciler may run it again at any time.
 *
 * The original is never rewritten (0004, decision 1): it stays byte-exact. Everything derived
 * from it goes through sharp, which drops all metadata unless told otherwise, and applies the
 * EXIF orientation first so nothing comes out sideways.
 */
@Injectable()
export class ImageSteps {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async original(assetId: string): Promise<{ path: string; bytes: Buffer }> {
    const [file] = await this.db
      .select({ path: assetFiles.path })
      .from(assetFiles)
      .where(
        and(eq(assetFiles.assetId, assetId), eq(assetFiles.kind, 'original')),
      )
      .limit(1);
    if (!file) {
      throw new UnrecoverableError(`Asset ${assetId} has no original`);
    }
    return { path: file.path, bytes: await readAll(this.storage, file.path) };
  }

  /** Decodes the whole file. A file the api's signature check let through but that is broken further in ends here, as `failed`. */
  async normalize(assetId: string): Promise<void> {
    const { path, bytes } = await this.original(assetId);
    let width: number;
    let height: number;
    try {
      const image = sharp(bytes, { failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
        throw new Error(`unsupported format ${meta.format}`);
      }
      // Decode the pixels, not just the header: a truncated file has a valid header.
      await image.clone().rotate().raw().toBuffer();
      const oriented = meta.orientation && meta.orientation >= 5;
      width = (oriented ? meta.height : meta.width) ?? 0;
      height = (oriented ? meta.width : meta.height) ?? 0;
    } catch (error) {
      throw new UnrecoverableError(
        `The original of ${assetId} cannot be decoded: ${String(error)}`,
      );
    }
    await this.db
      .update(assetFiles)
      .set({ width, height })
      .where(and(eq(assetFiles.assetId, assetId), eq(assetFiles.path, path)));
  }

  async thumbnails(assetId: string): Promise<void> {
    const { bytes } = await this.original(assetId);
    const kinds = Object.keys(THUMBNAIL_WIDTHS) as Array<
      keyof typeof THUMBNAIL_WIDTHS
    >;
    const rows: Array<typeof assetFiles.$inferInsert> = [];
    for (const kind of kinds) {
      // First frame only for animated GIFs (a known limit of 0004).
      const { data, info } = await sharp(bytes, { animated: false })
        .rotate()
        .resize({ width: THUMBNAIL_WIDTHS[kind], withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const path = assetFilePath(assetId, kind);
      const stored = await this.storage.put(path, data, { mime: 'image/webp' });
      rows.push({
        assetId,
        kind: kind as AssetFileKind,
        path,
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
          and(eq(assetFiles.assetId, assetId), inArray(assetFiles.kind, kinds)),
        );
      await tx.insert(assetFiles).values(rows);
    });
  }

  /** The last cheap step: afterwards the asset is viewable, classified or not (0004). */
  async colors(assetId: string): Promise<void> {
    const { bytes } = await this.original(assetId);
    const { data } = await sharp(bytes, { animated: false })
      .rotate()
      .resize(64, 64, { fit: 'inside' })
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const palette = extractPalette(new Uint8Array(data));

    await this.db.transaction(async (tx) => {
      await tx.delete(assetColors).where(eq(assetColors.assetId, assetId));
      if (palette.length > 0) {
        await tx.insert(assetColors).values(
          palette.map((color, position) => ({
            assetId,
            hex: color.hex,
            labL: color.lab[0],
            labA: color.lab[1],
            labB: color.lab[2],
            ratio: color.ratio,
            position,
          })),
        );
      }
      await tx
        .update(assets)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(assets.id, assetId));
    });
  }

  /** The image the model sees: 1568 px on the long edge, WebP, no metadata (0004). */
  async modelImage(assetId: string): Promise<Buffer> {
    const { bytes } = await this.original(assetId);
    return sharp(bytes, { animated: false })
      .rotate()
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  }

  async markFailed(assetId: string): Promise<void> {
    await this.db
      .update(assets)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(assets.id, assetId));
  }
}
