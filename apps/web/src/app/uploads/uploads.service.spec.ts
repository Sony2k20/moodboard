import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AssetSummary, UploadsService } from './uploads.service';

const file = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const asset = (change: Partial<AssetSummary>): AssetSummary => ({
  id: 'a',
  title: null,
  status: 'ready',
  classified: true,
  createdAt: new Date().toISOString(),
  createdBy: 'Ada',
  thumbnailUrl: null,
  ...change,
});

describe('UploadsService', () => {
  let http: HttpTestingController;
  let service: UploadsService;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(UploadsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    http.verify();
  });

  it('sends one request per file, so one failure does not take the others with it', () => {
    service.upload([file('a.png'), file('b.png')]);
    const requests = http.match({ method: 'POST', url: '/api/assets' });
    expect(requests).toHaveLength(2);

    requests[0].flush(null, { status: 415, statusText: 'Unsupported' });
    requests[1].flush({ id: 'b' });
    http.expectOne('/api/assets?limit=30').flush([]);

    expect(service.uploads()).toEqual([
      expect.objectContaining({ name: 'a.png', error: 'unsupported' }),
    ]);
  });

  it('maps 413 to "too large"', () => {
    service.upload([file('huge.png')]);
    http
      .expectOne('/api/assets')
      .flush(null, { status: 413, statusText: 'Too large' });
    expect(service.uploads()[0].error).toBe('tooLarge');
  });

  it('keeps polling while something is pending, and stops once everything is settled', async () => {
    const refresh = service.refresh();
    http
      .expectOne('/api/assets?limit=30')
      .flush([asset({ status: 'pending', classified: false })]);
    await refresh;

    jest.advanceTimersByTime(4000);
    http.expectOne('/api/assets?limit=30').flush([asset({})]);
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(10_000);
    http.expectNone('/api/assets?limit=30');
  });
});
