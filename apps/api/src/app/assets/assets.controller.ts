import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AssetDetail,
  AssetQuerySchema,
  AssetSearchResult,
  MAX_UPLOAD_BYTES,
  sniffUploadFormat,
  VocabularyFacet,
} from '@moodboard/shared';
import { z } from 'zod';
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { AssetSearchService } from './asset-search.service';
import { AssetsService } from './assets.service';

/**
 * One file per request (0004): several files are several requests, so one bad file does not
 * take the others with it and each has its own progress. Multer's limit answers 413 itself.
 */
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly assetSearch: AssetSearchService,
  ) {}

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

  /** The search behind the overview and, later, `search_assets` (0005). */
  @Get()
  search(@Query() raw: Record<string, unknown>): Promise<AssetSearchResult> {
    const parsed = AssetQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(z.prettifyError(parsed.error));
    }
    return this.assetSearch.search(parsed.data);
  }

  @Get(':id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetDetail> {
    const asset = await this.assetSearch.detail(id);
    if (!asset) {
      throw new NotFoundException();
    }
    return asset;
  }
}

/** The controlled vocabulary with its labels — what the filters render, later `list_vocabulary`. */
@Controller('vocabulary')
export class VocabularyController {
  constructor(private readonly search: AssetSearchService) {}

  @Get()
  list(): Promise<VocabularyFacet[]> {
    return this.search.vocabulary();
  }
}
