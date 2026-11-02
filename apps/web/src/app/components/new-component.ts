import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ComponentCode } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { ComponentEditor } from './component-editor';

/** A starting point that shows what the three fields are for, and that the preview runs. */
const EXAMPLE: ComponentCode = {
  html: '<button class="cta">Get started</button>',
  css: `.cta {
  padding: 0.8rem 1.4rem;
  border: 0;
  border-radius: 999px;
  background: #1d1d1f;
  color: #fff;
  font: 600 1rem system-ui, sans-serif;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.2);
}`,
  js: '',
  width: 390,
};

/** `/components/new` (0018): write a component, watch it run, save it as an asset. */
@Component({
  selector: 'mb-new-component',
  imports: [ComponentEditor, RouterLink, TranslocoPipe],
  template: `
    <a class="back" routerLink="/">← {{ 'detail.back' | transloco }}</a>
    <h1>{{ 'component.new' | transloco }}</h1>
    <p class="intro">{{ 'component.intro' | transloco }}</p>
    <form (submit)="$event.preventDefault(); save()">
      <label class="title">
        <span>{{ 'component.title' | transloco }}</span>
        <input maxlength="200" [placeholder]="'component.titleHint' | transloco" (input)="title.set($any($event.target).value)" />
      </label>
      <mb-component-editor [(code)]="code" />
      @if (error(); as error) {
      <p role="alert" class="error">{{ 'component.error.' + error | transloco }}</p>
      }
      <button type="submit" [disabled]="saving() || !code().html.trim()">{{ 'component.save' | transloco }}</button>
    </form>
  `,
  styles: `
    :host { display: block; }
    h1 { margin: 0.5rem 0 0.25rem; font-size: 1.4rem; }
    .back { color: inherit; }
    .intro { color: var(--ink-soft); max-width: 48rem; }
    form { display: grid; gap: 1rem; }
    .title { display: grid; gap: 0.2rem; max-width: 30rem; font-size: 0.85rem; }
    .title span { color: var(--ink-soft); }
    button[type='submit'] { justify-self: start; }
    .error { color: var(--danger); }
  `,
})
export class NewComponentPage {
  private readonly api = inject(AssetsApi);
  private readonly router = inject(Router);
  protected readonly code = signal<ComponentCode>(EXAMPLE);
  protected readonly title = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<'invalid' | 'failed' | null>(null);

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const { id } = await this.api.createComponent({ ...this.code(), title: this.title().trim() || undefined });
      void this.router.navigate(['/assets', id]);
    } catch (error) {
      this.error.set(error instanceof HttpErrorResponse && error.status === 400 ? 'invalid' : 'failed');
    } finally {
      this.saving.set(false);
    }
  }
}
