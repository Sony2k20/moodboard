import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BOARD_ROLES, BoardRole, BoardSummary } from '@moodboard/shared';
import { BoardsApi } from './boards-api.service';

/** The value of the board select that creates a board first. */
const NEW_BOARD = '__new__';

/**
 * "Add to board" (0019), for the overview's selection and the detail page. The boards load when
 * the select is first used, not with the page; a smart board takes no items, so only manual ones
 * are offered.
 */
@Component({
  selector: 'mb-add-to-board',
  imports: [TranslocoPipe],
  template: `
    <form class="add" (submit)="$event.preventDefault(); add(board.value)">
      <select
        #board
        [attr.aria-label]="'boards.add.board' | transloco"
        (focus)="load()"
        (pointerdown)="load()"
      >
        <option value="">{{ 'boards.add.choose' | transloco }}</option>
        @for (b of boards(); track b.id) {
          <option [value]="b.id">{{ b.title }}</option>
        }
        <option [value]="newBoard">{{ 'boards.add.new' | transloco }}</option>
      </select>
      @if (withRole()) {
        <select (change)="role.set($any($event.target).value)" [attr.aria-label]="'boards.role.label' | transloco">
          @for (r of roles; track r) {
            <option [value]="r">{{ 'boards.role.' + r | transloco }}</option>
          }
        </select>
      }
      <button type="submit" [disabled]="busy() || assetIds().length === 0">
        {{ 'boards.add.submit' | transloco }}
      </button>
      @if (status(); as s) {
        <small [attr.role]="s.error ? 'alert' : 'status'" [class.error]="s.error">
          {{ s.key | transloco: { count: s.count, title: s.title } }}
        </small>
      }
    </form>
  `,
  styles: `
    .add {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }
    select {
      max-width: 14rem;
    }
    small {
      color: var(--ink-soft);
    }
    small.error {
      color: var(--danger);
    }
  `,
})
export class AddToBoard {
  readonly assetIds = input.required<readonly string[]>();
  /** The detail page asks for a role; the overview's selection goes in as `overall`. */
  readonly withRole = input(false);

  private readonly api = inject(BoardsApi);
  private readonly transloco = inject(TranslocoService);
  protected readonly roles = BOARD_ROLES;
  protected readonly newBoard = NEW_BOARD;
  protected readonly boards = signal<readonly BoardSummary[]>([]);
  protected readonly role = signal<BoardRole>('overall');
  protected readonly busy = signal(false);
  protected readonly status = signal<{
    key: string;
    count?: number;
    title?: string;
    error?: boolean;
  } | null>(null);
  private loading: Promise<void> | null = null;

  protected load(): Promise<void> {
    this.loading ??= this.api
      .list()
      .then((list) => this.boards.set(list.filter((b) => b.kind === 'manual')))
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  protected async add(boardId: string): Promise<void> {
    if (!boardId) {
      return;
    }
    this.busy.set(true);
    this.status.set(null);
    try {
      let id = boardId;
      let title = this.boards().find((b) => b.id === boardId)?.title ?? '';
      if (boardId === NEW_BOARD) {
        title = prompt(this.transloco.translate('boards.add.newTitle'))?.trim() ?? '';
        if (!title) {
          return;
        }
        id = (await this.api.create({ title })).id;
        this.loading = null;
        await this.load();
      }
      const { added } = await this.api.addItems(id, {
        assetIds: [...this.assetIds()],
        role: this.withRole() ? this.role() : 'overall',
      });
      this.status.set({
        key: added === 0 ? 'boards.add.already' : 'boards.add.done',
        count: added,
        title,
      });
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.status.set({ key: status === 409 ? 'boards.add.full' : 'boards.add.failed', error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
