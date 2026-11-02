import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BOARD_ROLES, BoardRole, BoardSummary } from '@moodboard/shared';
import { BoardsApi } from './boards-api.service';

/** The list entry that creates a board first. */
const NEW_BOARD = '__new__';
const STATUS_MS = 2500;

let nextListId = 0;

/**
 * "Add to board" (0019), for the inspector, the overview's selection and the detail page. One
 * button opens the boards; choosing one adds at once (0020). The boards load when the list is
 * first opened, not with the page; a smart board takes no items, so only manual ones are offered.
 */
@Component({
  selector: 'mb-add-to-board',
  imports: [TranslocoPipe],
  template: `
    @if (withRole()) {
      <select
        class="role"
        (change)="role.set($any($event.target).value)"
        [attr.aria-label]="'boards.role.label' | transloco"
      >
        @for (r of roles; track r) {
          <option [value]="r">{{ 'boards.role.' + r | transloco }}</option>
        }
      </select>
    }
    <div class="anchor" [class.up]="up()">
      <button
        #toggle
        type="button"
        class="toggle"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [disabled]="assetIds().length === 0"
        [attr.aria-busy]="busy()"
        (click)="toggleOpen()"
      >
        {{ label() | transloco }}
      </button>
      @if (open()) {
        <div class="list" [id]="listId" role="group" [attr.aria-label]="'boards.add.board' | transloco">
          @for (b of boards(); track b.id) {
            <button type="button" [title]="b.title" (click)="add(b.id)">{{ b.title }}</button>
          }
          <button type="button" class="new" (click)="add(newBoard)">{{ 'boards.add.new' | transloco }}</button>
        </div>
      }
    </div>
    @if (status(); as s) {
      @if (s.error) {
        <small role="alert" class="error">{{ s.key | transloco }}</small>
      } @else {
        <span role="status" class="visually-hidden">{{ s.key | transloco: { title: s.title } }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }
    .role {
      max-width: 10rem;
    }
    .anchor {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
    }
    .toggle {
      flex: 1 1 auto;
      min-width: 0;
      padding: 0.45em 0.9em;
      border: 1px solid var(--ink-soft);
      border-radius: 999px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .toggle:hover,
    .toggle[aria-expanded='true'] {
      border-color: var(--ink);
    }
    .toggle:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .list {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 30;
      display: grid;
      min-width: max(100%, 14rem);
      max-width: 20rem;
      max-height: 16rem;
      overflow-y: auto;
      padding: 0.3rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.12);
    }
    /* At the bottom of the inspector and the selection bar, the list opens upwards. */
    .up .list {
      top: auto;
      bottom: calc(100% + 4px);
    }
    .list button {
      padding: 0.4rem 0.6rem;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--ink);
      font: inherit;
      font-size: 0.9rem;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .list button:hover,
    .list button:focus-visible {
      background: var(--wash);
    }
    .list .new {
      color: var(--ink-soft);
    }
    .error {
      flex-basis: 100%;
      color: var(--danger);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class AddToBoard {
  readonly assetIds = input.required<readonly string[]>();
  /** The detail page asks for a role; everywhere else an asset goes in as `overall`. */
  readonly withRole = input(false);
  /** Open the list upwards, for a place at the bottom of the screen. */
  readonly up = input(false);

  private readonly api = inject(BoardsApi);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toggle = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  protected readonly roles = BOARD_ROLES;
  protected readonly newBoard = NEW_BOARD;
  protected readonly listId = `add-to-board-${nextListId++}`;
  protected readonly boards = signal<readonly BoardSummary[]>([]);
  protected readonly role = signal<BoardRole>('overall');
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly status = signal<{ key: string; title?: string; error?: boolean } | null>(
    null,
  );
  private loading: Promise<void> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  /** The button says what just happened, as "Copy prompt" does; the status says it in full. */
  protected readonly label = computed(() => {
    const status = this.status();
    if (status && !status.error) {
      return status.key === 'boards.add.already' ? 'boards.add.alreadyShort' : 'boards.add.added';
    }
    return 'boards.add.button';
  });

  constructor() {
    // Other assets: what was said about the previous ones no longer applies.
    effect(() => {
      this.assetIds();
      untracked(() => {
        this.open.set(false);
        this.setStatus(null);
      });
    });
  }

  protected toggleOpen(): void {
    if (this.busy()) {
      return;
    }
    if (!this.open()) {
      this.setStatus(null);
      void this.load();
    }
    this.open.update((open) => !open);
  }

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
    // The chosen entry goes with the list; focus returns to where the list came from.
    this.open.set(false);
    this.toggle().nativeElement.focus();
    this.busy.set(true);
    this.setStatus(null);
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
      this.setStatus({ key: added === 0 ? 'boards.add.already' : 'boards.add.done', title });
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.setStatus({ key: status === 409 ? 'boards.add.full' : 'boards.add.failed', error: true });
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  /** Closes the list first; only a second Escape reaches the inspector underneath. */
  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.open()) {
      event.stopPropagation();
      this.open.set(false);
      this.toggle().nativeElement.focus();
    }
  }

  private setStatus(status: { key: string; title?: string; error?: boolean } | null): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.status.set(status);
    if (status && !status.error) {
      this.statusTimer = setTimeout(() => this.status.set(null), STATUS_MS);
    }
  }
}
