import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { ByteRange, STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The file names the storage layout produces (§4.2) — nothing else is ever served. */
const FILE =
  /^(original\.(png|jpg|webp|gif)|thumb-(sm|md|lg)\.webp|poster\.webp|capture\.mp4)$/;
const FRAME = /^\d{2}\.webp$/;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
};

/** One `bytes=` range; multipart ranges are answered with the whole file, which is allowed. */
const RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * The bytes a `Range` header asks for, both ends inclusive, or `null` for the whole file and
 * `'unsatisfiable'` for a range outside it. A browser seeks a video this way (0011).
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  const match = header ? RANGE.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  let start: number;
  let end: number;
  if (match[1] === '') {
    // `bytes=-500`: the last 500 bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

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
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!UUID.test(assetId) || !FILE.test(file)) {
      throw new NotFoundException();
    }
    return this.send(`${assetId}/${file}`, res, req.headers.range);
  }

  private async send(path: string, res: Response, rangeHeader?: string): Promise<void> {
    const stat = await this.storage.stat(path);
    if (!stat) {
      throw new NotFoundException();
    }
    const extension = path.slice(path.lastIndexOf('.') + 1);
    res.setHeader(
      'Content-Type',
      MIME[extension] ?? 'application/octet-stream',
    );
    res.setHeader('Accept-Ranges', 'bytes');
    // Private: these are behind a login. A file at a given path never changes content except
    // when a step is re-run, so a day is safe and saves the grid most requests.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const range = parseRange(rangeHeader, stat.bytes);
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${stat.bytes}`);
      res.end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.bytes}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.setHeader('Content-Length', String(stat.bytes));
    }
    await pipeline(Readable.from(await this.storage.get(path, range ?? undefined)), res);
  }
}
