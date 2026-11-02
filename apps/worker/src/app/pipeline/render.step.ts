import { Inject, Injectable } from '@nestjs/common';
import { assetFiles, componentCode, Database } from '@moodboard/db';
import { assetFilePath, STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import { UnrecoverableError } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { ComponentRenderer } from '../capture/component-renderer';
import { DATABASE } from '../database.module';

export const COMPONENT_RENDERER = Symbol('COMPONENT_RENDERER');

/**
 * `render` (0018), the first step for a component: its code, rendered by the worker's browser,
 * becomes the `poster` every later step works from. It runs again after every save of the code,
 * and replaces the poster an earlier run stored.
 */
@Injectable()
export class RenderStep {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(COMPONENT_RENDERER) private readonly renderer: ComponentRenderer,
  ) {}

  async run(assetId: string): Promise<void> {
    const [code] = await this.db
      .select()
      .from(componentCode)
      .where(eq(componentCode.assetId, assetId))
      .limit(1);
    if (!code) {
      throw new UnrecoverableError(`Asset ${assetId} has no component code`);
    }

    const png = await this.renderer.render(code);
    const { data, info } = await sharp(png).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    const path = assetFilePath(assetId, 'poster');
    const stored = await this.storage.put(path, data, { mime: 'image/webp' });
    await this.db.transaction(async (tx) => {
      await tx
        .delete(assetFiles)
        .where(and(eq(assetFiles.assetId, assetId), eq(assetFiles.kind, 'poster')));
      await tx.insert(assetFiles).values({
        assetId,
        kind: 'poster',
        path,
        mime: 'image/webp',
        width: info.width,
        height: info.height,
        bytes: stored.bytes,
      });
    });
  }
}
