import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  AssetDetail,
  AssetTextPatchSchema,
  BulkActionSchema,
  BulkResult,
  FacetValuesSchema,
  TagListSchema,
  TrashItem,
} from '@moodboard/shared';
import { z } from 'zod';
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { AssetEditService } from './asset-edit.service';
import { AssetSearchService } from './asset-search.service';

/** Days an asset stays in the trash; the worker's purge reads the same setting. */
export const TRASH_RETENTION_DAYS = 'TRASH_RETENTION_DAYS';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/**
 * Editing (0006). Every change is answered with the asset as it is now, so the detail page shows
 * what was actually stored — including what the guards made of it.
 */
@Controller('assets')
export class AssetEditController {
  constructor(
    private readonly edit: AssetEditService,
    private readonly assetSearch: AssetSearchService,
  ) {}

  @Patch(':id')
  async updateText(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<AssetDetail> {
    await this.edit.updateText(id, parse(AssetTextPatchSchema, body), user);
    return this.current(id);
  }

  @Put(':id/facets/:facet')
  async setFacet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('facet') facet: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<AssetDetail> {
    await this.edit.setFacet(id, facet, parse(FacetValuesSchema, body).values, user);
    return this.current(id);
  }

  @Put(':id/tags')
  async setTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<AssetDetail> {
    await this.edit.setTags(id, parse(TagListSchema, body).tags, user);
    return this.current(id);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(@Body() body: unknown, @User() user: CurrentUser): Promise<BulkResult> {
    return this.edit.bulk(parse(BulkActionSchema, body), user);
  }

  @Delete(':id')
  @HttpCode(204)
  async trash(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.edit.trash(id, user);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: CurrentUser,
  ): Promise<AssetDetail> {
    await this.edit.restore(id, user);
    return this.current(id);
  }

  private async current(id: string): Promise<AssetDetail> {
    const asset = await this.assetSearch.detail(id);
    if (!asset) {
      throw new NotFoundException();
    }
    return asset;
  }
}

@Controller('trash')
export class TrashController {
  constructor(
    private readonly assetSearch: AssetSearchService,
    @Inject(TRASH_RETENTION_DAYS) private readonly retentionDays: number,
  ) {}

  @Get()
  list(@User() user: CurrentUser): Promise<TrashItem[]> {
    return this.assetSearch.trash(user, this.retentionDays);
  }
}
