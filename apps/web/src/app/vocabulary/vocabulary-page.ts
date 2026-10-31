import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CURATED_FACET_KEYS,
  LocalizedText,
  VocabularyFacet,
  vocabularyKeyFrom,
  VOCABULARY_KEY_PATTERN,
} from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { Vocabulary } from '../assets/vocabulary';
import { SessionService } from '../auth/session.service';

type VocabularyValue = VocabularyFacet['values'][number];

/**
 * The vocabulary, and where admins maintain the curated facets (0014): `project` values are
 * added, relabelled and — while unused — deleted here. The classified facets are listed
 * read-only: their values are part of the prompt and change in code.
 */
@Component({
  selector: 'mb-vocabulary',
  imports: [TranslocoPipe],
  templateUrl: './vocabulary-page.html',
  styleUrl: './vocabulary-page.css',
})
export class VocabularyPage {
  private readonly api = inject(AssetsApi);
  private readonly transloco = inject(TranslocoService);
  protected readonly vocabulary = inject(Vocabulary);
  private readonly session = inject(SessionService);
  protected readonly admin = computed(() => this.session.user()?.role === 'admin');

  /** How many assets carry each value, from the search's counts; trashed ones are not counted. */
  protected readonly usage = resource({
    loader: async () => {
      const { counts } = await this.api.search({ limit: 1 });
      return new Map(counts.facets.map((c) => [`${c.facet}:${c.value}`, c.count]));
    },
  });

  protected readonly curated = computed(() =>
    this.vocabulary.facets().filter((facet) => CURATED_FACET_KEYS.includes(facet.key)),
  );
  protected readonly classified = computed(() =>
    this.vocabulary.facets().filter((facet) => !CURATED_FACET_KEYS.includes(facet.key)),
  );

  // The new-value form. The key and the German label follow the English one until edited.
  protected readonly labelEn = signal('');
  protected readonly labelDe = signal('');
  protected readonly key = signal('');
  private keyEdited = false;
  private deEdited = false;
  protected readonly keyValid = computed(
    () => this.key().length <= 64 && VOCABULARY_KEY_PATTERN.test(this.key()),
  );

  /** The value being relabelled, as `facet:value`. */
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<'exists' | 'inUse' | 'invalid' | 'failed' | null>(null);

  protected uses(facet: string, value: string): number {
    return this.usage.value()?.get(`${facet}:${value}`) ?? 0;
  }

  protected onLabelEn(text: string): void {
    this.labelEn.set(text);
    if (!this.keyEdited) {
      this.key.set(vocabularyKeyFrom(text));
    }
    if (!this.deEdited) {
      this.labelDe.set(text);
    }
  }

  protected onLabelDe(text: string): void {
    this.deEdited = true;
    this.labelDe.set(text);
  }

  protected onKey(text: string): void {
    this.keyEdited = true;
    this.key.set(text.trim());
  }

  protected async create(facet: string): Promise<void> {
    const label = { en: this.labelEn().trim(), de: this.labelDe().trim() };
    if (!label.en || !label.de || !this.keyValid()) {
      this.error.set('invalid');
      return;
    }
    const done = await this.write(
      () => this.api.createValue(facet, { value: this.key(), label, description: null }),
      'exists',
    );
    if (done) {
      this.labelEn.set('');
      this.labelDe.set('');
      this.key.set('');
      this.keyEdited = false;
      this.deEdited = false;
    }
  }

  protected edit(facet: string, value: VocabularyValue): void {
    this.error.set(null);
    this.editing.set(`${facet}:${value.value}`);
  }

  protected async save(
    facet: string,
    value: VocabularyValue,
    en: string,
    de: string,
    descriptionEn: string,
    descriptionDe: string,
  ): Promise<void> {
    const label: LocalizedText = { en: en.trim(), de: de.trim() };
    const hasDescription = descriptionEn.trim() || descriptionDe.trim();
    if (!label.en || !label.de || (hasDescription && !(descriptionEn.trim() && descriptionDe.trim()))) {
      this.error.set('invalid');
      return;
    }
    const description = hasDescription
      ? { en: descriptionEn.trim(), de: descriptionDe.trim() }
      : null;
    if (
      await this.write(() => this.api.updateValue(facet, value.value, { label, description }), 'failed')
    ) {
      this.editing.set(null);
    }
  }

  protected async remove(facet: string, value: VocabularyValue): Promise<void> {
    const name = this.vocabulary.text(value.label);
    if (!confirm(this.transloco.translate('vocabulary.confirmDelete', { name }))) {
      return;
    }
    // A trashed asset still counts as a use, which the counts here do not show: the api says so.
    await this.write(() => this.api.deleteValue(facet, value.value), 'inUse');
  }

  /**
   * Runs an admin write; the answer replaces the vocabulary everywhere in the app. `conflict` is
   * what a `409` means for this write: a key that exists, or a value still in use.
   */
  private async write(
    request: () => Promise<readonly VocabularyFacet[]>,
    conflict: 'exists' | 'inUse' | 'failed',
  ): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.vocabulary.replace(await request());
      this.usage.reload();
      return true;
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.error.set(status === 409 ? conflict : status === 400 ? 'invalid' : 'failed');
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
