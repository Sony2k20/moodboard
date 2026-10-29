import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';

const REASONS = ['expired', 'not_permitted', 'failed'] as const;

/** Where the api's login callback sends the browser when it cannot sign the user in. */
@Component({
  selector: 'mb-login-failed',
  imports: [TranslocoPipe],
  template: `
    <h1>{{ 'loginFailed.title' | transloco }}</h1>
    <p>{{ 'loginFailed.reason.' + reason() | transloco }}</p>
    <p>
      <a href="/api/auth/login">{{ 'loginFailed.retry' | transloco }}</a>
    </p>
  `,
})
export class LoginFailed {
  private readonly query = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('reason'))),
  );

  protected readonly reason = computed(() => {
    const value = this.query();
    return (REASONS as readonly string[]).includes(value ?? '')
      ? (value as string)
      : 'failed';
  });
}
