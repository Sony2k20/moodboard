import { DatePipe } from '@angular/common';
import { Component, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardsApi } from './boards-api.service';

/**
 * Every board (0019): a curated set of references for one purpose. Manual boards are curated item
 * by item; smart boards are a filter saved from the overview.
 */
@Component({
  selector: 'mb-boards',
  imports: [TranslocoPipe, DatePipe, RouterLink],
  templateUrl: './boards-page.html',
  styleUrl: './boards-page.css',
})
export class BoardsPage {
  private readonly api = inject(BoardsApi);
  private readonly router = inject(Router);
  protected readonly boards = resource({ loader: () => this.api.list() });
  protected readonly creating = signal(false);
  protected readonly createFailed = signal(false);

  protected async create(title: string): Promise<void> {
    if (!title.trim()) {
      return;
    }
    this.creating.set(true);
    this.createFailed.set(false);
    try {
      const { id } = await this.api.create({ title: title.trim() });
      await this.router.navigate(['/boards', id]);
    } catch {
      this.createFailed.set(true);
    } finally {
      this.creating.set(false);
    }
  }
}
