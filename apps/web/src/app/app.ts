import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Locale, SessionService } from './auth/session.service';

@Component({
  imports: [RouterLink, RouterOutlet, TranslocoPipe],
  selector: 'mb-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly session = inject(SessionService);
  protected readonly locales: readonly Locale[] = ['en', 'de'];

  protected changeLocale(event: Event): void {
    void this.session.setLocale(
      (event.target as HTMLSelectElement).value as Locale,
    );
  }

  protected logout(): void {
    void this.session.logout();
  }
}
