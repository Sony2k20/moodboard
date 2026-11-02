import { DatePipe, PercentPipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  inject,
  Injector,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AssetDetail,
  AssetQuerySchema,
  BOARD_ROLES,
  BOARD_WEIGHTS,
  BoardDetail,
  BoardItem,
  BoardItemPatch,
  BoardRole,
  BoardWeight,
  TOKEN_FORMATS,
  TokenFormat,
} from '@moodboard/shared';
import { Vocabulary } from '../assets/vocabulary';
import { SessionService } from '../auth/session.service';
import { BoardsApi } from './boards-api.service';

/**
 * One board (0019): the briefing, the items with role, weight and note, and what the board says
 * as a whole. Everything derived — palette, type, motion, direction, conflicts, tokens, prompt —
 * comes from the api; the page only shows it. Items are reordered by drag and drop, or with the
 * move buttons from the keyboard.
 */
@Component({
  selector: 'mb-board',
  imports: [TranslocoPipe, RouterLink, DatePipe, PercentPipe],
  templateUrl: './board-page.html',
  styleUrl: './board-page.css',
})
export class BoardPage {
  /** Bound from the route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(BoardsApi);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  protected readonly vocabulary = inject(Vocabulary);

  protected readonly roles = BOARD_ROLES;
  protected readonly weights = BOARD_WEIGHTS;
  protected readonly formats = TOKEN_FORMATS;

  protected readonly board = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.detail(params),
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly editingTitle = signal(false);
  protected readonly briefingDirty = signal(false);
  protected readonly format = signal<TokenFormat>('css');
  protected readonly copied = signal<string | null>(null);
  /** The item being dragged, by index. */
  protected readonly dragging = signal<number | null>(null);
  protected readonly dropTarget = signal<number | null>(null);

  protected readonly manual = computed(() => this.board.value()?.kind === 'manual');

  protected readonly canDelete = computed(() => {
    const user = this.session.user();
    const board = this.board.value();
    return !!user && !!board && (user.role === 'admin' || user.id === board.author.id);
  });

  /** A smart board's filter as chips, labelled from the vocabulary. */
  protected readonly filter = computed(() => {
    const filter = this.board.value()?.filter;
    const parsed = filter ? AssetQuerySchema.safeParse(filter) : null;
    return parsed?.success ? parsed.data : null;
  });

  protected readonly tokens = computed(() => {
    const tokens = this.board.value()?.tokens;
    if (!tokens) {
      return '';
    }
    const value = tokens[this.format()];
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  protected readonly hasTokens = computed(
    () => Object.keys(this.board.value()?.tokens.json ?? {}).length > 0,
  );

  /** Asset ids → titles, for the derived values that name their sources. */
  private readonly titles = computed(
    () => new Map((this.board.value()?.items ?? []).map((i) => [i.asset.id, this.title(i.asset)])),
  );

  protected title(asset: AssetDetail): string {
    return asset.title ?? asset.sourceUrl ?? this.transloco.translate('asset.untitled');
  }

  protected titlesOf(ids: readonly string[]): string {
    return ids.map((id) => this.titles().get(id) ?? id).join(', ');
  }

  protected thumbnail(asset: AssetDetail): string | null {
    return asset.files.find((f) => f.kind === 'thumb_md')?.url ?? null;
  }

  protected async saveTitle(value: string): Promise<void> {
    const title = value.trim();
    this.editingTitle.set(false);
    if (!title || title === this.board.value()?.title) {
      return;
    }
    await this.apply(() => this.api.update(this.id(), { title }));
  }

  protected async saveBriefing(value: string): Promise<void> {
    if (value.trim() === this.board.value()?.briefing) {
      this.briefingDirty.set(false);
      return;
    }
    await this.apply(() => this.api.update(this.id(), { briefing: value }));
    this.briefingDirty.set(false);
  }

  protected setRole(item: BoardItem, role: string): Promise<void> {
    return this.patch(item, { role: role as BoardRole });
  }

  protected setWeight(item: BoardItem, weight: BoardWeight): Promise<void> {
    return this.patch(item, { weight });
  }

  protected setNote(item: BoardItem, note: string): Promise<void> {
    if (note.trim() === (item.note ?? '')) {
      return Promise.resolve();
    }
    return this.patch(item, { note });
  }

  protected async remove(item: BoardItem): Promise<void> {
    if (item.id) {
      const id = item.id;
      await this.apply(() => this.api.removeItem(this.id(), id));
    }
  }

  /** Move buttons: the keyboard's way to reorder. Focus follows the moved item. */
  protected async move(index: number, delta: -1 | 1, event?: Event): Promise<void> {
    const target = index + delta;
    const items = this.board.value()?.items ?? [];
    if (target < 0 || target >= items.length) {
      return;
    }
    // Read before awaiting: `currentTarget` is only set while the event is dispatched.
    const list = (event?.currentTarget as HTMLElement | undefined)?.closest('ol');
    await this.reorder(index, target);
    // After the render that re-enables the buttons: a disabled button takes no focus.
    afterNextRender(
      () => {
        const [up, down] =
          list?.querySelectorAll<HTMLButtonElement>(`li:nth-child(${target + 1}) .move`) ?? [];
        // At the top or bottom the same direction is disabled; the other button keeps the focus.
        const same = delta < 0 ? up : down;
        (same?.disabled ? (delta < 0 ? down : up) : same)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onDragStart(event: DragEvent, index: number): void {
    this.dragging.set(index);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onDragOver(event: DragEvent, index: number): void {
    if (this.dragging() === null) {
      return;
    }
    event.preventDefault();
    this.dropTarget.set(index);
  }

  protected async onDrop(event: DragEvent, index: number): Promise<void> {
    event.preventDefault();
    const from = this.dragging();
    this.onDragEnd();
    if (from !== null && from !== index) {
      await this.reorder(from, index);
    }
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  protected async deleteBoard(): Promise<void> {
    const board = this.board.value();
    if (!board || !confirm(this.transloco.translate('board.confirmDelete', { title: board.title }))) {
      return;
    }
    this.saving.set(true);
    try {
      await this.api.remove(board.id);
      await this.router.navigate(['/boards']);
    } catch {
      this.saveError.set('board.error.deleteFailed');
    } finally {
      this.saving.set(false);
    }
  }

  protected async copy(text: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(key);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      // Clipboard refused (no permission, insecure context): the text is selectable on the page.
    }
  }

  /** The order changes at once on the page; the api's answer then replaces it. */
  private async reorder(from: number, to: number): Promise<void> {
    const board = this.board.value();
    if (!board) {
      return;
    }
    const items = [...board.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    this.board.value.set({ ...board, items });
    await this.apply(() => this.api.reorder(board.id, items.map((i) => i.id as string)));
  }

  private patch(item: BoardItem, patch: BoardItemPatch): Promise<void> {
    const itemId = item.id;
    return itemId ? this.apply(() => this.api.updateItem(this.id(), itemId, patch)) : Promise.resolve();
  }

  private async apply(request: () => Promise<BoardDetail>): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      this.board.value.set(await request());
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.saveError.set(status === 409 ? 'board.error.conflict' : 'board.error.saveFailed');
      this.board.reload();
    } finally {
      this.saving.set(false);
    }
  }
}
