import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UploadsService } from './uploads.service';

const file = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('UploadsService', () => {
  let http: HttpTestingController;
  let service: UploadsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(UploadsService);
  });

  afterEach(() => http.verify());

  it('sends one request per file, so one failure does not take the others with it', () => {
    service.upload([file('a.png'), file('b.png')]);
    const requests = http.match({ method: 'POST', url: '/api/assets' });
    expect(requests).toHaveLength(2);

    requests[0].flush(null, { status: 415, statusText: 'Unsupported' });
    requests[1].flush({ id: 'b' });

    expect(service.uploads()).toEqual([
      expect.objectContaining({ name: 'a.png', error: 'unsupported' }),
    ]);
    expect(service.completed()).toBe(1);
  });

  it('maps 413 to "too large"', () => {
    service.upload([file('huge.png')]);
    http
      .expectOne('/api/assets')
      .flush(null, { status: 413, statusText: 'Too large' });
    expect(service.uploads()[0].error).toBe('tooLarge');
    expect(service.completed()).toBe(0);
  });

  it('hands a URL to the api for capture, and counts it like an upload (0011)', () => {
    service.capture('https://example.com/');
    const request = http.expectOne({ method: 'POST', url: '/api/assets/websites' });
    expect(request.request.body).toEqual({ url: 'https://example.com/' });
    request.flush({ id: 'site' });
    expect(service.uploads()).toEqual([]);
    expect(service.completed()).toBe(1);
  });

  it('maps 400 on a URL to "invalid URL"', () => {
    service.capture('https://intranet/');
    http
      .expectOne('/api/assets/websites')
      .flush(null, { status: 400, statusText: 'Bad Request' });
    expect(service.uploads()[0].error).toBe('invalidUrl');
  });
});
