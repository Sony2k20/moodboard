import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The file names the storage layout produces (§4.2) — nothing else is ever served. */
const FILE =
  /^(original\.(png|jpg|webp|gif)|thumb-(sm|md|lg)\.webp|poster\.webp|capture\.webm)$/;
const FRAME = /^\d{2}\.webp$/;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  webm: 'video/webm',
};

/**
 * Stored files, behind the session guard like everything else — all assets are visible to all
 * signed-in users, and to nobody else (§2). Outside the `/api` prefix because the storage port
 * builds `/files/…` URLs and the ingress already routes `/files` here.
 */
@Controller('files')
export class FilesController {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get(':assetId/frames/:file')
  async frame(
    @Param('assetId') assetId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    if (!UUID.test(assetId) || !FRAME.test(file)) {
      throw new NotFoundException();
    }
    return this.send(`${assetId}/frames/${file}`, res);
  }

  @Get(':assetId/:file')
  async file(
    @Param('assetId') assetId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    if (!UUID.test(assetId) || !FILE.test(file)) {
      throw new NotFoundException();
    }
    return this.send(`${assetId}/${file}`, res);
  }

  private async send(path: string, res: Response): Promise<void> {
    const stat = await this.storage.stat(path);
    if (!stat) {
      throw new NotFoundException();
    }
    const extension = path.slice(path.lastIndexOf('.') + 1);
    res.setHeader(
      'Content-Type',
      MIME[extension] ?? 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(stat.bytes));
    // Private: these are behind a login. A file at a given path never changes content except
    // when a step is re-run, so a day is safe and saves the grid most requests.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(Readable.from(await this.storage.get(path)), res);
  }
}
