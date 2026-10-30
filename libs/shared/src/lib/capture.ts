/**
 * Why a website capture failed (0011), stored in `asset.status_reason`. Machine-readable keys,
 * never translated (§13.3); the web shows them through `asset.capture.failed.<reason>`.
 */
export const CAPTURE_FAILURES = [
  'blocked',
  'unreachable',
  'http-error',
  'timeout',
  'blank',
  'forbidden-target',
] as const;

export type CaptureFailure = (typeof CAPTURE_FAILURES)[number];

/** Worth another attempt: the site may answer next time. The others would fail the same way. */
export function isRetryableCaptureFailure(reason: CaptureFailure): boolean {
  return reason === 'unreachable' || reason === 'timeout';
}

/**
 * A URL a person may hand in for capture (0011): http or https, a host, no credentials. A bare
 * `example.com` gets `https://`. Returns the normalised URL without its fragment, or `null`.
 *
 * Whether the host may be reached is decided in the worker, which resolves the name — the
 * browser bundle, which imports this too, cannot.
 */
export function parseCaptureUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048 || /\s/.test(trimmed)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  // A single-label name ("intranet", "valkey") is no website anyone means to keep; a typo like
  // "https//foo" lands here too. `localhost` passes, so the worker refuses it with a reason.
  const host = url.hostname;
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (!host.includes('.') && !host.includes(':') && host !== 'localhost') ||
    url.username ||
    url.password
  ) {
    return null;
  }
  url.hash = '';
  return url.toString();
}
