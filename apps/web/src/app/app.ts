import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Locale, SessionService } from './auth/session.service';
import { CommandPalette } from './command-palette/command-palette';
import { UploadsService } from './uploads/uploads.service';

/**
 * The shell (0020): the library and the boards up front, "+ Add" beside them, and everything
 * that is about the person or the instance — language, palette, tokens, trash, administration —
 * in the account menu.
 */
@Component({
  imports: [CommandPalette, RouterLink, RouterLinkActive, RouterOutlet, TranslocoPipe],
  selector: 'mb-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly session = inject(SessionService);
  protected readonly uploads = inject(UploadsService);
  private readonly router = inject(Router);
  protected readonly locales: readonly Locale[] = ['en', 'de'];
  protected readonly menuOpen = signal(false);

  protected changeLocale(event: Event): void {
    void this.session.setLocale(
      (event.target as HTMLSelectElement).value as Locale,
    );
  }

  protected logout(): void {
    void this.session.logout();
  }

  /** The add panel belongs to the library; from anywhere else, "+ Add" goes there first. */
  protected toggleAdd(): void {
    const open = !this.uploads.panelOpen();
    this.uploads.panelOpen.set(open);
    if (open && this.router.url.split(/[?#]/)[0] !== '/') {
      void this.router.navigate(['/']);
    }
  }

  protected closeMenu(toggle: HTMLElement): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      toggle.focus();
    }
  }

  /** A link or button in the menu has done its job; the language select has not. */
  protected onMenuClick(event: MouseEvent): void {
    if ((event.target as Element).closest('a, button')) {
      this.menuOpen.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen() && !(event.target as Element).closest?.('.account')) {
      this.menuOpen.set(false);
    }
  }
}
