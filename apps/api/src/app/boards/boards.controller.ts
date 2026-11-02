import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  BoardCreateSchema,
  BoardDetail,
  BoardItemPatchSchema,
  BoardItemsAddSchema,
  BoardOrderSchema,
  BoardPatchSchema,
  BoardSummary,
} from '@moodboard/shared';
import { z } from 'zod';
import { User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { BoardsService } from './boards.service';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/**
 * Boards (0019). Every change is answered with the board as it is now — items, derived values,
 * tokens and prompt — so the page never computes any of them itself.
 */
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list(): Promise<BoardSummary[]> {
    return this.boards.list();
  }

  @Post()
  create(@Body() body: unknown, @User() user: CurrentUser): Promise<{ id: string }> {
    return this.boards.create(parse(BoardCreateSchema, body), user);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<BoardDetail> {
    return this.current(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<BoardDetail> {
    await this.boards.update(id, parse(BoardPatchSchema, body), user);
    return this.current(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @User() user: CurrentUser): Promise<void> {
    await this.boards.remove(id, user);
  }

  @Post(':id/items')
  @HttpCode(200)
  async addItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<{ added: number }> {
    return this.boards.addItems(id, parse(BoardItemsAddSchema, body), user);
  }

  @Patch(':id/items/:itemId')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<BoardDetail> {
    await this.boards.updateItem(id, itemId, parse(BoardItemPatchSchema, body), user);
    return this.current(id);
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @User() user: CurrentUser,
  ): Promise<BoardDetail> {
    await this.boards.removeItem(id, itemId, user);
    return this.current(id);
  }

  @Put(':id/order')
  async reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @User() user: CurrentUser,
  ): Promise<BoardDetail> {
    await this.boards.reorder(id, parse(BoardOrderSchema, body).itemIds, user);
    return this.current(id);
  }

  private async current(id: string): Promise<BoardDetail> {
    const board = await this.boards.detail(id);
    if (!board) {
      throw new NotFoundException();
    }
    return board;
  }
}
