import { Component, computed, DestroyRef, inject, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { COMPONENT_WIDTHS, ComponentCode, MAX_COMPONENT_CHARS } from '@moodboard/shared';
import { ComponentPreview } from './component-preview';

type Field = 'html' | 'css' | 'js';

/** The preview follows the typing this long after the last key, so it does not flicker. */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Writing a component (0018): HTML, CSS and JavaScript side by side with the running preview.
 * `code` is two-way: the page that holds the editor saves what it ends up as.
 */
@Component({
  selector: 'mb-component-editor',
  imports: [ComponentPreview, TranslocoPipe],
  template: `
    <div class="editor">
      <div class="fields">
        @for (field of fields; track field) {
        <label>
          <span>{{ 'component.fields.' + field | transloco }}</span>
          <textarea
            spellcheck="false"
            autocapitalize="off"
            [attr.maxlength]="max"
            [rows]="field === 'html' ? 10 : 8"
            [value]="code()[field]"
            (input)="change(field, $any($event.target).value)"
          ></textarea>
        </label>
        }
        <label class="width">
          <span>{{ 'component.width' | transloco }}</span>
          <select (change)="setWidth(+$any($event.target).value)">
            @for (w of widths; track w) {
            <option [value]="w" [selected]="w === code().width">{{ w }} px</option>
            }
          </select>
        </label>
      </div>
      <mb-component-preview [code]="preview()" />
    </div>
  `,
  styles: `
    .editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
    .fields { display: grid; gap: 0.6rem; }
    label { display: grid; gap: 0.2rem; font-size: 0.85rem; }
    label span { color: var(--ink-soft); }
    textarea { width: 100%; box-sizing: border-box; font: 0.85rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; resize: vertical; }
    .width { justify-self: start; }
    @media (max-width: 60rem) { .editor { grid-template-columns: 1fr; } }
  `,
})
export class ComponentEditor {
  readonly code = model.required<ComponentCode>();

  protected readonly fields: readonly Field[] = ['html', 'css', 'js'];
  protected readonly widths = COMPONENT_WIDTHS;
  protected readonly max = MAX_COMPONENT_CHARS;
  /** The code as of the last pause in typing; until the first keystroke, the code as given. */
  private readonly settled = signal<ComponentCode | null>(null);
  protected readonly preview = computed(() => this.settled() ?? this.code());
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected change(field: Field, value: string): void {
    this.code.update((code) => ({ ...code, [field]: value }));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settled.set(this.code()), PREVIEW_DEBOUNCE_MS);
  }

  protected setWidth(width: number): void {
    this.code.update((code) => ({ ...code, width }));
    this.settled.set(this.code());
  }
}
