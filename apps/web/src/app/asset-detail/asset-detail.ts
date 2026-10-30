import { DatePipe, PercentPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AssetDetail, buildPrompt, VocabularyFacet } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';
import { SessionService } from '../auth/session.service';
import { OverviewStore } from '../overview/overview.store';

interface FacetRow {
  readonly facet: VocabularyFacet;
  readonly values: AssetDetail['facets'];
  readonly decided: boolean;
}

/** What is open for editing: one field at a time. */
type Editing = 'title' | 'description' | `facet:${string}` | null;

/**
 * One asset (0005), editable (0006). Every save goes to the api as a person's change and the page
 * then shows the asset as the api returns it — what was actually stored, guards included.
 */
@Component({
  selector: 'mb-asset-detail',
  imports: [RouterLink, TranslocoPipe, DatePipe, PercentPipe],
  templateUrl: './asset-detail.html',
  styleUrl: './asset-detail.css',
})
export class AssetDetailPage {
  /** Bound from the route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(AssetsApi);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly overview = inject(OverviewStore);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly transloco = inject(TranslocoService);

  /** Back to the search this asset was opened from, not to a blank overview. */
  protected readonly backLink = computed(() =>
    this.router.parseUrl(this.overview.lastUrl()),
  );

  protected readonly asset = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.detail(params),
  });

  protected readonly editing = signal<Editing>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);
  /** The values ticked in the open facet editor. */
  protected readonly draftValues = signal<ReadonlySet<string>>(new Set());

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

  /** Every facet of the vocabulary that has values, in its order, with this asset's values. */
  protected readonly rows = computed<FacetRow[]>(() => {
    const asset = this.asset.value();
    if (!asset) {
      return [];
    }
    return this.vocabulary
      .facets()
      .filter((facet) => facet.values.length > 0)
      .map((facet) => ({
        facet,
        values: asset.facets.filter((v) => v.facet === facet.key),
        decided: asset.decidedFacets.includes(facet.key),
      }));
  });

  /** The build prompt (0008): recomputed from the metadata, so every edit shows at once. */
  protected readonly prompt = computed(() => {
    const asset = this.asset.value();
    return asset ? buildPrompt(asset, this.vocabulary.facets()) : '';
  });
  protected readonly copied = signal(false);

  /** Deleting: own assets, or any as an admin (§9). The api checks it again. */
  protected readonly mayDelete = computed(() => {
    const user = this.session.user();
    const asset = this.asset.value();
    return !!user && !!asset && (user.role === 'admin' || user.id === asset.author.id);
  });

  protected facetLink(facet: string, value: string): Record<string, string> {
    return { facet: `${facet}:${value}` };
  }

  protected edit(field: Editing): void {
    this.saveError.set(false);
    if (field?.startsWith('facet:')) {
      const key = field.slice('facet:'.length);
      this.draftValues.set(
        new Set(this.asset.value()?.facets.filter((v) => v.facet === key).map((v) => v.value)),
      );
    }
    this.editing.set(field);
  }

  protected async copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.prompt());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard refused (no permission, insecure context): the text is selectable in the preview.
    }
  }

  protected editFacet(key: string): void {
    this.edit(`facet:${key}`);
  }

  protected toggleDraft(facet: VocabularyFacet, value: string): void {
    this.draftValues.update((current) => {
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

  protected saveTitle(value: string): Promise<void> {
    return this.save(() => this.api.updateText(this.id(), { title: value }));
  }

  protected saveDescription(value: string): Promise<void> {
    return this.save(() => this.api.updateText(this.id(), { description: value }));
  }

  protected saveFacet(facet: VocabularyFacet): Promise<void> {
    // Vocabulary order, not click order.
    const values = facet.values.map((v) => v.value).filter((v) => this.draftValues().has(v));
    return this.save(() => this.api.setFacet(this.id(), facet.key, values));
  }

  protected addTag(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    const current = this.asset.value()?.tags.map((t) => t.name) ?? [];
    if (!name) {
      return Promise.resolve();
    }
    input.value = '';
    return this.save(() => this.api.setTags(this.id(), [...current, name]));
  }

  protected removeTag(name: string): Promise<void> {
    const current = this.asset.value()?.tags.map((t) => t.name) ?? [];
    return this.save(() =>
      this.api.setTags(
        this.id(),
        current.filter((t) => t !== name),
      ),
    );
  }

  protected async remove(): Promise<void> {
    if (!confirm(this.transloco.translate('detail.confirmDelete'))) {
      return;
    }
    await this.save(async () => {
      await this.api.trash(this.id());
      await this.router.navigateByUrl(this.backLink());
      return null;
    });
  }

  private async save(write: () => Promise<AssetDetail | null>): Promise<void> {
    this.saving.set(true);
    this.saveError.set(false);
    try {
      const updated = await write();
      if (updated) {
        this.asset.value.set(updated);
      }
      this.editing.set(null);
    } catch {
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
