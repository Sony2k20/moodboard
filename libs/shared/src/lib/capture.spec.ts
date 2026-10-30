import { parseCaptureUrl } from './capture';
import { firstPipelineStep, nextPipelineStep, pipelineQueueOf } from './pipeline';

describe('parseCaptureUrl', () => {
  it('accepts http and https, and adds https to a bare host', () => {
    expect(parseCaptureUrl('https://example.com/a?b=1#top')).toBe(
      'https://example.com/a?b=1',
    );
    expect(parseCaptureUrl('  http://example.com ')).toBe('http://example.com/');
    expect(parseCaptureUrl('example.com/work')).toBe('https://example.com/work');
  });

  it('lets local and literal addresses through, for the worker to refuse with a reason', () => {
    expect(parseCaptureUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(parseCaptureUrl('http://10.0.0.1')).toBe('http://10.0.0.1/');
    expect(parseCaptureUrl('http://[::1]/')).toBe('http://[::1]/');
  });

  it('refuses other schemes, credentials, single-label hosts and junk', () => {
    for (const raw of [
      '',
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:secret@example.com',
      'http://intranet/',
      'not a url',
      `https://example.com/${'a'.repeat(2100)}`,
    ]) {
      expect(parseCaptureUrl(raw)).toBeNull();
    }
  });
});

describe('pipelines', () => {
  it('starts an upload with normalize and a website with capture', () => {
    expect(firstPipelineStep('image')).toBe('normalize');
    expect(firstPipelineStep('website')).toBe('capture');
  });

  it('runs the shared steps after either start', () => {
    expect(nextPipelineStep('normalize', 'image')).toBe('thumbnails');
    expect(nextPipelineStep('capture', 'website')).toBe('thumbnails');
    expect(nextPipelineStep('colors', 'website')).toBe('classify');
    expect(nextPipelineStep('classify', 'website')).toBeNull();
  });

  it('treats a job without a pipeline as an upload, as every job before 0011 was', () => {
    expect(nextPipelineStep('normalize')).toBe('thumbnails');
  });

  it('puts capture in its own queue', () => {
    expect(pipelineQueueOf('capture')).toBe('capture');
    expect(pipelineQueueOf('thumbnails')).toBe('pipeline');
  });
});
