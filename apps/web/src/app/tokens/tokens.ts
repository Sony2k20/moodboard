import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiTokenItem, CreatedApiToken } from '@moodboard/shared';
import { firstValueFrom } from 'rxjs';

/**
 * Personal API tokens for MCP clients (0010). A new token is shown once, with the command that
 * adds this server to Claude Code; afterwards only its name and prefix remain.
 */
@Component({
  selector: 'mb-tokens',
  imports: [TranslocoPipe, DatePipe],
  templateUrl: './tokens.html',
  styleUrl: './tokens.css',
})
export class TokensPage {
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly tokens = resource({
    loader: () => firstValueFrom(this.http.get<ApiTokenItem[]>('/api/tokens')),
  });
  protected readonly created = signal<CreatedApiToken | null>(null);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly copied = signal(false);

  /** The URL as this browser reaches it — the repository names no host (CLAUDE.md). */
  protected readonly endpoint = `${window.location.origin}/api/mcp`;

  protected readonly command = computed(() => {
    const token = this.created()?.token ?? '<token>';
    return `claude mcp add --transport http moodboard ${this.endpoint} --header "Authorization: Bearer ${token}"`;
  });

  protected async create(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name) {
      return;
    }
    this.busy.set(true);
    this.failed.set(false);
    try {
      const created = await firstValueFrom(
        this.http.post<CreatedApiToken>('/api/tokens', { name }),
      );
      this.created.set(created);
      this.tokens.value.update((list) => [created.item, ...(list ?? [])]);
      input.value = '';
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async revoke(item: ApiTokenItem): Promise<void> {
    if (!confirm(this.transloco.translate('tokens.confirmRevoke', { name: item.name }))) {
      return;
    }
    try {
      await firstValueFrom(this.http.delete(`/api/tokens/${item.id}`));
      this.tokens.value.update((list) => list?.filter((t) => t.id !== item.id));
      if (this.created()?.item.id === item.id) {
        this.created.set(null);
      }
    } catch {
      this.failed.set(true);
    }
  }

  protected async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard refused: the command stays selectable on the page.
    }
  }
}
