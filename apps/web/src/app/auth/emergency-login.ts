import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { NAVIGATE } from './session.service';

type EmergencyError =
  | 'notAvailable'
  | 'wrongPassword'
  | 'locked'
  | 'disabled'
  | 'failed';

/**
 * The emergency admin's login (§4.10). Reachable as a page from anywhere, but the api answers the
 * POST only when it arrives through the LAN entry point — from the internet it is a 404, shown
 * here as "not available from this network".
 */
@Component({
  selector: 'mb-emergency-login',
  imports: [FormsModule, TranslocoPipe],
  template: `
    <h1>{{ 'emergency.title' | transloco }}</h1>
    <p>{{ 'emergency.explanation' | transloco }}</p>
    <form (ngSubmit)="submit()">
      <label>
        {{ 'emergency.password' | transloco }}
        <input
          type="password"
          name="password"
          autocomplete="current-password"
          required
          [(ngModel)]="password"
        />
      </label>
      <button type="submit" [disabled]="busy() || !password">
        {{ 'emergency.submit' | transloco }}
      </button>
    </form>
    @if (error(); as key) {
      <p role="alert">{{ 'emergency.error.' + key | transloco }}</p>
    }
  `,
})
export class EmergencyLogin {
  private readonly http = inject(HttpClient);
  private readonly navigate = inject(NAVIGATE);

  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<EmergencyError | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/auth/emergency', { password: this.password }),
      );
      // A full reload, so the session is read the same way as after an OIDC login.
      this.navigate('/');
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.error.set(
        status === 404
          ? 'notAvailable'
          : status === 401
            ? 'wrongPassword'
            : status === 429
              ? 'locked'
              : status === 503
                ? 'disabled'
                : 'failed',
      );
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }
}
