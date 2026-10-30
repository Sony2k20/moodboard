import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiTokenItem,
  CreateApiTokenSchema,
  CreatedApiToken,
} from '@moodboard/shared';
import { z } from 'zod';
import { User } from './auth.guard';
import { ApiTokensService } from './api-tokens.service';
import type { CurrentUser } from './users.service';

/**
 * A person's own API tokens (0010), behind the session like every route. Nobody sees or revokes
 * another person's tokens, admins included: a token is a credential, not content.
 */
@Controller('tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  list(@User() user: CurrentUser): Promise<ApiTokenItem[]> {
    return this.tokens.list(user);
  }

  @Post()
  create(@Body() body: unknown, @User() user: CurrentUser): Promise<CreatedApiToken> {
    const parsed = CreateApiTokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(z.prettifyError(parsed.error));
    }
    return this.tokens.create(user, parsed.data.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @User() user: CurrentUser,
  ): Promise<void> {
    await this.tokens.revoke(user, id);
  }
}
