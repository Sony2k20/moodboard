import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  AssetDetail,
  buildPrompt,
  unconfirmedFacetKeys,
  VocabularyFacet,
} from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';

interface FacetRow {
  readonly facet: VocabularyFacet;
  readonly values: AssetDetail['facets'];
  readonly decided: boolean;
  /** Still only a model's guess: shown dashed, counted, and confirmed by "Confirm all". */
  readonly unconfirmed: boolean;
}

const PENDING_POLL_MS = 4000;

/**
 * The docked panel beside the grid (0012): look at an asset, correct it, confirm the model's
 * guesses, copy its prompt — without leaving the overview. Every write is the detail page's
 * (0006): a facet is saved as a whole through `PUT …/facets/:facet`, which makes its values
 * `human` and records the decision, so a confirmation survives every re-analysis.
 */
@Component({
  selector: 'mb-inspector',
  imports: [RouterLink, TranslocoPipe, DatePipe],
  templateUrl: './inspector.html',
  styleUrl: './inspector.css',
  host: { '[attr.aria-busy]': 'saving()' },
})
export class Inspector {
  readonly id = input.required<string>();
  readonly closed = output<void>();
  /** The asset as stored after an edit, for its tile. */
  readonly changed = output<AssetDetail>();

  private readonly api = inject(AssetsApi);
  protected readonly vocabulary = inject(Vocabulary);

  protected readonly asset = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.detail(params),
  });

  /** The facet whose vocabulary is open, or the title; one at a time. */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<ReadonlySet<string>>(new Set());
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);
  protected readonly copied = signal(false);
  protected readonly retrying = signal(false);

  protected readonly notFound = computed(() => {
    const error = this.asset.error();
    return error instanceof HttpErrorResponse && [400, 404].includes(error.status);
  });

  protected readonly image = computed(() => {
    const files = this.asset.value()?.files ?? [];
    return {
      large: files.find((f) => f.kind === 'thumb_lg') ?? files.find((f) => f.kind === 'thumb_md'),
      original: files.find((f) => f.kind === 'original'),
    };
  });

  protected readonly rows = computed<FacetRow[]>(() => {
    const asset = this.asset.value();
    if (!asset) {
      return [];
    }
    const unconfirmed = new Set(unconfirmedFacetKeys(asset.facets, asset.decidedFacets));
    return this.vocabulary
      .facets()
      .filter((facet) => facet.values.length > 0)
      .map((facet) => ({
        facet,
        values: asset.facets.filter((v) => v.facet === facet.key),
        decided: asset.decidedFacets.includes(facet.key),
        unconfirmed: unconfirmed.has(facet.key),
      }));
  });

  protected readonly guesses = computed(() => this.rows().filter((row) => row.unconfirmed));

  protected readonly prompt = computed(() => {
    const asset = this.asset.value();
    return asset ? buildPrompt(asset, this.vocabulary.facets()) : '';
  });

  constructor() {
    // Another asset: nothing of the previous one stays open.
    effect(() => {
      this.id();
      untracked(() => {
        this.editing.set(null);
        this.saveError.set(false);
        this.copied.set(false);
      });
    });
    // A capture or classification still running: follow it, as the detail page does.
    effect((onCleanup) => {
      if (this.asset.value()?.status !== 'pending') {
        return;
      }
      const timer = setTimeout(() => this.asset.reload(), PENDING_POLL_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    const target = event.target;
    if (this.editing()) {
      this.editing.set(null);
    } else if (!(target instanceof Element && target.closest('input, textarea, select'))) {
      this.closed.emit();
    }
  }

  protected editFacet(row: FacetRow): void {
    if (this.editing() === row.facet.key) {
      this.editing.set(null);
      return;
    }
    this.saveError.set(false);
    this.draft.set(new Set(row.values.map((v) => v.value)));
    this.editing.set(row.facet.key);
  }

  protected editTitle(): void {
    this.saveError.set(false);
    this.editing.set('title');
  }

  protected toggleDraft(facet: VocabularyFacet, value: string): void {
    this.draft.update((current) => {
      if (!facet.isMultiValue) {
        return new Set(current.has(value) ? [] : [value]);
      }
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  protected saveFacet(facet: VocabularyFacet): Promise<void> {
    // Vocabulary order, not click order.
    const values = facet.values.map((v) => v.value).filter((v) => this.draft().has(v));
    return this.save(() => this.api.setFacet(this.id(), facet.key, values));
  }

  protected saveTitle(value: string): Promise<void> {
    return this.save(() => this.api.updateText(this.id(), { title: value }));
  }

  /**
   * Saves every undecided facet with the values it already holds. One write per facet, one after
   * the other: each is the ordinary facet edit with its own audit entry, and a failure part-way
   * leaves the facets saved so far confirmed — the panel shows what was stored.
   */
  protected confirmAll(): Promise<void> {
    const id = this.id();
    const rows = this.guesses();
    return this.save(async () => {
      let latest: AssetDetail | null = null;
      try {
        for (const row of rows) {
          latest = await this.api.setFacet(id, row.facet.key, row.values.map((v) => v.value));
        }
      } catch (error) {
        if (latest) {
          this.apply(latest);
        }
        throw error;
      }
      return latest;
    });
  }

  protected async copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.prompt());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard refused: the full prompt stays one click away on the detail page.
    }
  }

  protected async retryCapture(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.api.retryCapture(this.id());
      this.asset.reload();
    } catch {
      this.saveError.set(true);
    } finally {
      this.retrying.set(false);
    }
  }

  protected host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  private async save(write: () => Promise<AssetDetail | null>): Promise<void> {
    const id = this.id();
    this.saving.set(true);
    this.saveError.set(false);
    try {
      const updated = await write();
      if (updated) {
        this.apply(updated);
      }
      if (id === this.id()) {
        this.editing.set(null);
      }
    } catch {
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  private apply(updated: AssetDetail): void {
    if (updated.id === this.id()) {
      this.asset.value.set(updated);
    }
    this.changed.emit(updated);
  }
}
