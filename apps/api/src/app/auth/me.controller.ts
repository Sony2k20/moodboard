import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { LocaleSchema } from '@moodboard/shared';
import { z } from 'zod';
import { User } from './auth.guard';
import { CurrentUser, UsersService } from './users.service';

const UpdateMeSchema = z.object({ locale: LocaleSchema }).strict();

/** The signed-in user. The web app's first request: 401 sends it to the login. */
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@User() user: CurrentUser): CurrentUser {
    return user;
  }

  /** Only the locale is the user's to change; name, e-mail and role come from Authentik (§9). */
  @Patch()
  async update(
    @User() user: CurrentUser,
    @Body() body: unknown,
  ): Promise<CurrentUser> {
    const parsed = UpdateMeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const updated = await this.users.setLocale(user.id, parsed.data.locale);
    if (parsed.data.locale !== user.locale) {
      await this.users.audit('user.locale_changed', user.id, {
        from: user.locale,
        to: parsed.data.locale,
      });
    }
    return updated ?? user;
  }
}
