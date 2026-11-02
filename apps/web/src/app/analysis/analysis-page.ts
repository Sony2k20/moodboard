import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ANALYSIS_STATES, MAX_FAILED_RUNS } from '@moodboard/shared';
import { AssetsApi } from '../assets/assets-api.service';
import { SessionService } from '../auth/session.service';

/** While jobs are queued, the counts move as runs finish; refreshed this often. */
const POLL_MS = 5000;

/**
 * Batch re-analysis (0015): how current the model's metadata is across the collection, what it
 * costs, and the two corpus actions. Admins only; re-running a selection lives in the bulk bar.
 */
@Component({
  selector: 'mb-analysis',
  imports: [DatePipe, RouterLink, TranslocoPipe],
  templateUrl: './analysis-page.html',
  styleUrl: './analysis-page.css',
})
export class AnalysisPage {
  private readonly api = inject(AssetsApi);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(SessionService);
  protected readonly admin = computed(() => this.session.user()?.role === 'admin');
  protected readonly states = ANALYSIS_STATES;
  protected readonly maxFailed = MAX_FAILED_RUNS;

  protected readonly summary = resource({
    params: () => (this.admin() ? true : undefined),
    loader: () => this.api.analysis(),
  });

  protected readonly busy = signal(false);
  protected readonly message = signal<{ key: string; count?: number } | null>(null);

  constructor() {
    const timer = setInterval(() => {
      const queued = this.summary.value()?.queued;
      if (queued && !this.summary.isLoading()) {
        this.summary.reload();
      }
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected usd(value: number): string {
    return new Intl.NumberFormat(this.session.user()?.locale ?? 'en', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value < 1 ? 3 : 2,
    }).format(value);
  }

  protected async run(scope: 'outdated' | 'stuck'): Promise<void> {
    const summary = this.summary.value();
    if (!summary) {
      return;
    }
    const count = summary.states[scope];
    const average = summary.cost.averageRunUsd;
    const question =
      average === null
        ? this.transloco.translate('analysis.confirmUnknownCost', { count })
        : this.transloco.translate('analysis.confirm', { count, cost: this.usd(count * average) });
    if (!confirm(question)) {
      return;
    }
    this.busy.set(true);
    this.message.set(null);
    try {
      const { queued } = await this.api.requestAnalysis({ scope });
      this.message.set({ key: 'analysis.queued', count: queued });
      this.summary.reload();
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.message.set({ key: status === 409 ? 'analysis.error.disabled' : 'analysis.error.request' });
    } finally {
      this.busy.set(false);
    }
  }
}
