import { DatePipe } from '@angular/common';
import { Component, inject, resource, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AssetsApi } from '../assets/assets-api.service';

/**
 * The trash (0006): what was deleted, and when it goes for good. Members see their own assets,
 * admins everyone's (§9) — the api decides, the page shows what it gets.
 */
@Component({
  selector: 'mb-trash',
  imports: [TranslocoPipe, DatePipe],
  templateUrl: './trash.html',
  styleUrl: './trash.css',
})
export class TrashPage {
  private readonly api = inject(AssetsApi);
  protected readonly items = resource({ loader: () => this.api.trashList() });
  protected readonly restoring = signal<string | null>(null);
  protected readonly restoreFailed = signal(false);

  protected async restore(id: string): Promise<void> {
    this.restoring.set(id);
    this.restoreFailed.set(false);
    try {
      await this.api.restore(id);
      this.items.value.update((list) => list?.filter((item) => item.id !== id));
    } catch {
      this.restoreFailed.set(true);
    } finally {
      this.restoring.set(null);
    }
  }
}
