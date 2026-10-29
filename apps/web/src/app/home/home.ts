import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SessionService } from '../auth/session.service';

/** Placeholder until the overview UI (phase 1, later step): proves the login reached a user. */
@Component({
  selector: 'mb-home',
  imports: [TranslocoPipe],
  template: `
    @if (session.user(); as user) {
      <p>{{ 'home.signedInAs' | transloco: { name: user.displayName } }}</p>
    }
  `,
})
export class Home {
  protected readonly session = inject(SessionService);
}
