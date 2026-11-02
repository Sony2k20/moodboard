import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
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
  ComponentCodeSchema,
  ComponentCreateSchema,
  MAX_FONT_BYTES,
  MAX_UPLOAD_BYTES,
  parseCaptureUrl,
  sniffFontFormat,
  sniffUploadFormat,
  VocabularyFacet,
  VocabularyValueCreateSchema,
  VocabularyValuePatchSchema,
} from '@moodboard/shared';
import { z } from 'zod';

const WebsiteRequestSchema = z.object({
  url: z.string(),
  title: z.string().max(200).optional(),
});
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { AssetSearchService } from './asset-search.service';
import { AssetsService } from './assets.service';
import { UnreadableFontError } from './font-reader';
import { VocabularyAdminService } from './vocabulary-admin.service';

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
      // A font is its own asset type (0017): parsed here, its facts stored, its specimen drawn.
      const fontFormat = sniffFontFormat(file.buffer);
      if (!fontFormat) {
        throw new UnsupportedMediaTypeException(
          'Only PNG, JPEG, WebP and GIF images and WOFF2, WOFF, TTF and OTF fonts are accepted',
        );
      }
      if (file.size > MAX_FONT_BYTES) {
        throw new PayloadTooLargeException(`A font may be at most ${MAX_FONT_BYTES} bytes`);
      }
      try {
        return { id: (await this.assets.ingestFont({ bytes: file.buffer, format: fontFormat, userId: user.id })).id };
      } catch (error) {
        if (error instanceof UnreadableFontError) {
          throw new UnsupportedMediaTypeException(error.message);
        }
        throw error;
      }
    }
    const { id } = await this.assets.ingestUpload({
      bytes: file.buffer,
      format,
      fileName: file.originalname,
      userId: user.id,
    });
    return { id };
  }

  /** A website to capture (0011). Answers before anything is fetched; the worker captures. */
  @Post('websites')
  @HttpCode(202)
  async captureWebsite(
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<{ id: string }> {
    const parsed = WebsiteRequestSchema.safeParse(body);
    const url = parsed.success ? parseCaptureUrl(parsed.data.url) : null;
    if (!parsed.success || !url) {
      throw new BadRequestException('Expected an http or https URL in the field "url"');
    }
    const { id } = await this.assets.ingestUrl({
      url,
      title: parsed.data.title,
      userId: user.id,
    });
    return { id };
  }

  /** A component from its code (0018). Answers before it is rendered; the worker renders. */
  @Post('components')
  @HttpCode(202)
  async createComponent(@Body() body: unknown, @User() user: CurrentUser): Promise<{ id: string }> {
    const { title, ...code } = parseBody(ComponentCreateSchema, body);
    const { id } = await this.assets.ingestComponent({ code, title, userId: user.id });
    return { id };
  }

  /** A new version of a component's code (0018); answers with the asset as stored. */
  @Put(':id/component')
  async updateComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<AssetDetail> {
    if (!(await this.assets.updateComponent(id, parseBody(ComponentCodeSchema, body), user.id))) {
      throw new NotFoundException('No component with this id');
    }
    const asset = await this.assetSearch.detail(id);
    if (!asset) {
      throw new NotFoundException();
    }
    return asset;
  }

  /** Another attempt at a failed capture (0011). */
  @Post(':id/capture')
  @HttpCode(202)
  async retryCapture(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: CurrentUser,
  ): Promise<{ id: string }> {
    if (!(await this.assets.retryCapture(id, user.id))) {
      throw new ConflictException('Only a website whose capture failed can be captured again');
    }
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

/**
 * The controlled vocabulary with its labels — what the filters render, later `list_vocabulary`.
 * Admins maintain the curated facets' values here (0014); every write answers with the whole
 * vocabulary, so the page shows what was stored.
 */
@Controller('vocabulary')
export class VocabularyController {
  constructor(
    private readonly search: AssetSearchService,
    private readonly admin: VocabularyAdminService,
  ) {}

  @Get()
  list(): Promise<VocabularyFacet[]> {
    return this.search.vocabulary();
  }

  @Post(':facet/values')
  async create(
    @Param('facet') facet: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<VocabularyFacet[]> {
    await this.admin.create(facet, parseBody(VocabularyValueCreateSchema, body), user);
    return this.search.vocabulary();
  }

  @Patch(':facet/values/:value')
  async update(
    @Param('facet') facet: string,
    @Param('value') value: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<VocabularyFacet[]> {
    await this.admin.update(facet, value, parseBody(VocabularyValuePatchSchema, body), user);
    return this.search.vocabulary();
  }

  @Delete(':facet/values/:value')
  async remove(
    @Param('facet') facet: string,
    @Param('value') value: string,
    @User() user: CurrentUser,
  ): Promise<VocabularyFacet[]> {
    await this.admin.remove(facet, value, user);
    return this.search.vocabulary();
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(z.prettifyError(parsed.error));
  }
  return parsed.data;
}
