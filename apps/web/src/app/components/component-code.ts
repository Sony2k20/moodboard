import { Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AssetDetail, ComponentCode } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { ComponentEditor } from './component-editor';

type Field = 'html' | 'css' | 'js';

/**
 * A component's code on its detail page (0018): one pane per language with a copy button, and the
 * editor for a new version. Saving answers with the asset as stored; the picture and the
 * classification follow from the worker.
 */
@Component({
  selector: 'mb-component-code',
  imports: [ComponentEditor, TranslocoPipe],
  template: `
    <section class="code">
      <h2>
        {{ 'component.code' | transloco }}
        @if (!editing()) {
        <button type="button" class="edit" (click)="startEditing()">{{ 'component.edit' | transloco }}</button>
        }
      </h2>
      @if (editing() && draft(); as draft) {
      <mb-component-editor [code]="draft" (codeChange)="this.draft.set($event)" />
      @if (error()) {
      <p role="alert" class="error">{{ 'component.error.' + error() | transloco }}</p>
      }
      <div class="actions">
        <button type="button" [disabled]="saving() || !draft.html.trim()" (click)="save()">{{ 'component.save' | transloco }}</button>
        <button type="button" [disabled]="saving()" (click)="editing.set(false)">{{ 'component.cancel' | transloco }}</button>
      </div>
      } @else {
      <div role="tablist" class="tabs">
        @for (field of present(); track field) {
        <button type="button" role="tab" [attr.aria-selected]="field === tab()" (click)="tab.set(field)">
          {{ 'component.fields.' + field | transloco }}
        </button>
        }
        <button type="button" class="copy" (click)="copy()">
          {{ (copied() ? 'component.copied' : 'component.copy') | transloco }}
        </button>
      </div>
      <pre role="tabpanel"><code>{{ code()[tab()] }}</code></pre>
      @if (saved()) {
      <p role="status" class="hint">{{ 'component.saved' | transloco }}</p>
      }
      }
    </section>
  `,
  styles: `
    h2 { display: flex; gap: 0.5rem; align-items: baseline; margin: 1.5rem 0 0.5rem; font-size: 1rem; }
    .edit { padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 0.85rem; }
    .tabs { display: flex; gap: 0.25rem; align-items: center; }
    .tabs [role='tab'] { padding: 0.25rem 0.7rem; border: 1px solid var(--line); border-radius: 6px 6px 0 0; background: var(--wash); cursor: pointer; }
    .tabs [aria-selected='true'] { background: var(--surface); border-bottom-color: var(--surface); font-weight: 600; }
    .copy { margin-left: auto; }
    pre { margin: 0; max-height: 28rem; overflow: auto; padding: 0.75rem; border: 1px solid var(--line); border-radius: 0 8px 8px 8px; background: var(--wash); font-size: 0.8rem; line-height: 1.45; }
    .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .error { color: var(--danger); }
    .hint { color: var(--ink-soft); font-size: 0.85rem; }
  `,
})
export class ComponentCodeView {
  readonly assetId = input.required<string>();
  readonly code = input.required<ComponentCode>();
  readonly saved$ = output<AssetDetail>({ alias: 'saved' });

  private readonly api = inject(AssetsApi);
  protected readonly tab = signal<Field>('html');
  protected readonly editing = signal(false);
  protected readonly draft = signal<ComponentCode | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<'invalid' | 'failed' | null>(null);

  protected present(): Field[] {
    return (['html', 'css', 'js'] as const).filter((f) => f === 'html' || this.code()[f].trim());
  }

  protected startEditing(): void {
    this.draft.set({ ...this.code() });
    this.error.set(null);
    this.saved.set(false);
    this.editing.set(true);
  }

  protected async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.code()[this.tab()]);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const asset = await this.api.updateComponent(this.assetId(), draft);
      this.editing.set(false);
      this.saved.set(true);
      this.saved$.emit(asset);
    } catch (error) {
      this.error.set((error as { status?: number }).status === 400 ? 'invalid' : 'failed');
    } finally {
      this.saving.set(false);
    }
  }
}
