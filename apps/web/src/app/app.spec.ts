import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco, TranslocoService } from '@jsverse/transloco';
import { App } from './app';
import { CurrentUser, NAVIGATE, SessionService } from './auth/session.service';

const ada: CurrentUser = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'admin',
  locale: 'de',
};

describe('SessionService', () => {
  let http: HttpTestingController;
  let navigate: jest.Mock;
  let session: SessionService;

  beforeEach(() => {
    navigate = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({
          config: { availableLangs: ['en', 'de'], defaultLang: 'en' },
        }),
        { provide: NAVIGATE, useValue: navigate },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService);
  });

  afterEach(() => http.verify());

  async function initWith(status: number, path = '/', search = '') {
    const done = session.init(path, search);
    const req = http.expectOne('/api/me');
    if (status === 200) {
      req.flush(ada);
    } else {
      req.flush(null, { status, statusText: 'x' });
    }
    await done;
  }

  it('signs in and switches to the user’s language', async () => {
    await initWith(200);
    expect(session.state()).toBe('signedIn');
    expect(session.user()).toEqual(ada);
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('de');
  });

  it('sends an anonymous visitor to the login, remembering where they were', async () => {
    await initWith(401, '/assets/1', '?tab=colors');
    expect(session.state()).toBe('redirecting');
    expect(navigate).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=%2Fassets%2F1%3Ftab%3Dcolors',
    );
  });

  it.each(['/emergency', '/login-failed'])(
    'does not redirect away from %s',
    async (path) => {
      await initWith(401, path);
      expect(session.state()).toBe('anonymous');
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('shows the disabled state rather than redirecting when the api refuses data (503)', async () => {
    await initWith(503);
    expect(session.state()).toBe('disabled');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('follows the redirect the api returns on logout', async () => {
    const done = session.logout();
    http
      .expectOne({ method: 'POST', url: '/api/auth/logout' })
      .flush({ redirectUrl: 'https://idp/end' });
    await done;
    expect(navigate).toHaveBeenCalledWith('https://idp/end');
  });
});

describe('App', () => {
  it('shows the signed-in user with a logout button', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({
          config: {
            availableLangs: ['en', 'de'],
            defaultLang: 'en',
            missingHandler: { logMissingKey: false },
          },
        }),
      ],
    });
    const session = TestBed.inject(SessionService);
    session.user.set(ada);
    session.state.set('signedIn');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.user')?.textContent).toContain('Ada');
    expect(el.querySelector('button')).not.toBeNull();
    // ada.locale is 'de'; the select must show it, not the first option.
    expect(el.querySelector('select')?.value).toBe('de');
  });
});
