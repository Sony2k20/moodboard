import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { ComponentCode, componentDocument } from '@moodboard/shared';

/**
 * Runs a component's code (0018) in an `<iframe sandbox="allow-scripts">`: an opaque origin, so
 * the code reads nothing of the application and sends no request as the viewer, and the
 * document's own policy (`COMPONENT_CSP`) stops any request at all. That isolation is why the
 * document may bypass Angular's HTML sanitiser here — sanitising would strip the very scripts and
 * styles the preview exists to run.
 *
 * The frame is laid out at the component's width and scaled down to fit narrower space; its
 * height is what the document reports.
 */
@Component({
  selector: 'mb-component-preview',
  imports: [TranslocoPipe],
  template: `
    <div class="stage" #stage [style.height.px]="height() * scale()">
      <iframe
        #frame
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        [title]="'component.preview' | transloco"
        [srcdoc]="document()"
        [style.width.px]="code().width"
        [style.height.px]="height()"
        [style.transform]="'scale(' + scale() + ')'"
      ></iframe>
    </div>
    @if (scale() < 1) {
    <small>{{ 'component.scaled' | transloco: { width: code().width, percent: (scale() * 100).toFixed(0) } }}</small>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .stage { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    iframe { display: block; border: 0; transform-origin: 0 0; background: #fff; }
    small { color: var(--ink-soft); font-size: 0.8rem; }
  `,
})
export class ComponentPreview {
  readonly code = input.required<Pick<ComponentCode, 'html' | 'css' | 'js' | 'width'>>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');
  private readonly available = signal(0);
  protected readonly height = signal(240);

  protected readonly scale = computed(() => {
    const available = this.available();
    return available > 0 ? Math.min(1, available / this.code().width) : 1;
  });

  protected readonly document = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(componentDocument(this.code(), { reportHeight: true })),
  );

  constructor() {
    const onMessage = (event: MessageEvent) => {
      const height = (event.data as { mbComponentHeight?: unknown } | null)?.mbComponentHeight;
      if (event.source === this.frame().nativeElement.contentWindow && typeof height === 'number') {
        this.height.set(Math.min(Math.max(height, 80), 4000));
      }
    };
    window.addEventListener('message', onMessage);
    const observer = new ResizeObserver(([entry]) => this.available.set(entry.contentRect.width));
    queueMicrotask(() => observer.observe(this.stage().nativeElement));
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
    });
  }
}
