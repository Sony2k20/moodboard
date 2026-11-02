import {
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AssetCard } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';
import { Locale, SessionService } from '../auth/session.service';
import { OverviewStore } from '../overview/overview.store';
import { paletteRank } from './palette-match';

type Group = 'search' | 'facets' | 'assets' | 'pages';

interface Entry {
  readonly id: string;
  readonly group: Group;
  readonly label: string;
  /** Shown after the label: the facet of a value, `selected` for one already filtered by. */
  readonly hint?: string;
  readonly thumbnail?: string | null;
  readonly run: () => void;
}

/** Asset results wait this long after the last keystroke, and need this many characters. */
const ASSET_DEBOUNCE_MS = 200;
const ASSET_MIN_CHARS = 2;
const MAX_FACETS = 8;
const MAX_ASSETS = 8;

/**
 * The command palette (0016): Cmd/Ctrl+K anywhere, one input, and facet values, assets, a
 * full-text search and the pages as results. Focus stays in the input; ↑/↓ move the active
 * entry, Enter chooses it. Keys never leave the dialog, so review mode and the inspector do not
 * act on them underneath.
 */
@Component({
  selector: 'mb-command-palette',
  imports: [TranslocoPipe],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
})
export class CommandPalette {
  private readonly api = inject(AssetsApi);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  // Resolved on first use, not with the shell: the vocabulary loads when it is constructed, and
  // a palette nobody opened should not cost a request on every page.
  private get vocabulary(): Vocabulary {
    return this.injector.get(Vocabulary);
  }

  private get overview(): OverviewStore {
    return this.injector.get(OverviewStore);
  }

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly assets = signal<readonly AssetCard[]>([]);
  private returnFocus: HTMLElement | null = null;
  private assetTimer: ReturnType<typeof setTimeout> | undefined;
  private assetRequest = 0;

  protected readonly groups: readonly Group[] = ['search', 'facets', 'assets', 'pages'];

  protected readonly entries = computed<readonly Entry[]>(() => {
    const q = this.query().trim();
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);

    const search: Entry[] = q
      ? [{ id: 'search', group: 'search', label: t('palette.searchFor', { q }), run: () => this.searchFor(q) }]
      : [];

    const facets = q
      ? this.vocabulary
          .facets()
          .flatMap((facet) =>
            facet.values.map((value) => {
              const facetLabel = this.vocabulary.text(facet.label);
              const label = this.vocabulary.text(value.label);
              const rank = paletteRank(q, [label, value.value, facetLabel, facet.key]);
              const selected = this.overview.isSelected(facet.key, value.value);
              return {
                rank,
                entry: {
                  id: `facet:${facet.key}:${value.value}`,
                  group: 'facets' as const,
                  label: `${facetLabel}: ${label}`,
                  hint: selected ? t('palette.selected') : undefined,
                  run: () => this.toggleFacet(facet.key, value.value),
                },
              };
            }),
          )
          .filter((m) => m.rank !== null)
          .sort((a, b) => (a.rank as number) - (b.rank as number))
          .slice(0, MAX_FACETS)
          .map((m) => m.entry)
      : [];

    const assets: Entry[] = this.assets().map((asset) => ({
      id: `asset:${asset.id}`,
      group: 'assets',
      label: asset.title || asset.sourceUrl || t('palette.untitled'),
      thumbnail: asset.thumbnail?.url ?? null,
      run: () => void this.router.navigate(['/assets', asset.id]),
    }));

    const pages = this.pages()
      .map((page) => ({ page, rank: paletteRank(q, [page.label, ...page.keywords]) }))
      .filter((m) => m.rank !== null)
      .sort((a, b) => (a.rank as number) - (b.rank as number))
      .map((m) => m.page.entry);

    return [...search, ...facets, ...assets, ...pages];
  });

  private pages(): Array<{ label: string; keywords: string[]; entry: Entry }> {
    const t = (key: string) => this.transloco.translate(key);
    const user = this.session.user();
    const go = (path: string) => () => void this.router.navigate([path]);
    const page = (id: string, label: string, run: () => void, keywords: string[] = []) => ({
      label,
      keywords: [id, ...keywords],
      entry: { id: `page:${id}`, group: 'pages' as const, label, run },
    });
    const other: Locale = user?.locale === 'de' ? 'en' : 'de';
    return [
      page('overview', t('palette.pages.overview'), go('/'), ['home']),
      page('review', t('palette.pages.review'), go('/review')),
      page('trash', t('trash.title'), go('/trash')),
      page('tokens', t('tokens.nav'), go('/tokens'), ['api', 'mcp']),
      page('vocabulary', t('vocabulary.nav'), go('/vocabulary'), ['facets']),
      ...(user?.role === 'admin'
        ? [page('analysis', t('analysis.nav'), go('/analysis'), ['re-analyse', 'cost'])]
        : []),
      page(
        'language',
        t('palette.language.' + other),
        () => void this.session.setLocale(other),
        ['language', 'sprache', 'english', 'deutsch'],
      ),
      page('logout', t('auth.logout'), () => void this.session.logout(), ['sign out', 'abmelden']),
    ];
  }

  protected entriesOf(group: Group): readonly Entry[] {
    return this.entries().filter((e) => e.group === group);
  }

  protected indexOf(entry: Entry): number {
    return this.entries().indexOf(entry);
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKey(event: KeyboardEvent): void {
    if (this.isToggle(event) && this.session.user()) {
      event.preventDefault();
      this.open();
    }
  }

  /** Every key typed in the palette stays in it; the pages underneath never see it. */
  protected onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    const count = this.entries().length;
    if (this.isToggle(event)) {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.active.set(count ? (this.active() + 1) % count : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(count ? (this.active() - 1 + count) % count : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.entries()[this.active()];
      if (entry) {
        this.choose(entry);
      }
    }
  }

  protected onInput(text: string): void {
    this.query.set(text);
    this.active.set(0);
    clearTimeout(this.assetTimer);
    const q = text.trim();
    if (q.length < ASSET_MIN_CHARS) {
      this.assetRequest++;
      this.assets.set([]);
      return;
    }
    this.assetTimer = setTimeout(() => void this.loadAssets(q), ASSET_DEBOUNCE_MS);
  }

  protected choose(entry: Entry): void {
    this.close();
    entry.run();
  }

  /** Also from the header's button — the shortcut is not the only way in (0016). */
  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) {
      return;
    }
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.query.set('');
    this.assets.set([]);
    this.active.set(0);
    this.input().nativeElement.value = '';
    dialog.showModal();
    this.input().nativeElement.focus();
  }

  protected close(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) {
      dialog.close();
    }
  }

  /** The dialog closed — by Esc, a choice or a click outside: focus goes back where it was. */
  protected onClose(): void {
    clearTimeout(this.assetTimer);
    this.assetRequest++;
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  /** A click on the backdrop lands on the dialog element itself. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  private isToggle(event: KeyboardEvent): boolean {
    return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
  }

  private async loadAssets(q: string): Promise<void> {
    const request = ++this.assetRequest;
    try {
      const { items } = await this.api.search({ q, limit: MAX_ASSETS });
      if (request === this.assetRequest) {
        this.assets.set(items);
      }
    } catch {
      // The other results are still useful; a failed search just shows no assets.
    }
  }

  private searchFor(q: string): void {
    this.overview.setSearch(q);
  }

  private toggleFacet(facet: string, value: string): void {
    this.overview.toggleFacet(facet, value);
  }
}
