import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES, sniffUploadFormat } from '@moodboard/shared';
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { AssetsService, AssetSummary } from './assets.service';

/**
 * One file per request (0004): several files are several requests, so one bad file does not
 * take the others with it and each has its own progress. Multer's limit answers 413 itself.
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(
    // No `storage` option: multer then keeps the file in memory, which the 25 MB limit bounds.
    // No `fileFilter` either, and none may be added before the move to Nest 12: the multer that
    // Nest 11 pins has a DoS advisory (GHSA-q7qp-rjg7-q26m) that needs an async fileFilter.
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @User() user: CurrentUser,
  ): Promise<{ id: string }> {
    if (!file) {
      throw new BadRequestException('Expected one file in the field "file"');
    }
    const format = sniffUploadFormat(file.buffer);
    if (!format) {
      throw new UnsupportedMediaTypeException(
        'Only PNG, JPEG, WebP and GIF images are accepted',
      );
    }
    const { id } = await this.assets.ingestUpload({
      bytes: file.buffer,
      format,
      fileName: file.originalname,
      userId: user.id,
    });
    return { id };
  }

  @Get()
  recent(@Query('limit') limit?: string): Promise<AssetSummary[]> {
    const n = Number(limit ?? 30);
    return this.assets.recent(
      Number.isInteger(n) && n > 0 && n <= 100 ? n : 30,
    );
  }
}
