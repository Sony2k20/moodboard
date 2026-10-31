import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser, BrowserContextOptions } from 'playwright';

/** The scroll from top to bottom (0011 release 3): long enough to see reveals, short to watch. */
export const SCROLL_DURATION_MS = 10_000;
/** The last frame is held this long, so a reveal at the very bottom finishes on screen. */
const HOLD_MS = 1_000;
/** The second load, recorded, gets less patience than the first: the first one already worked. */
const NAVIGATION_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 5_000;
const TRANSCODE_TIMEOUT_MS = 45_000;

/** `ffmpeg` from the image (Debian), or wherever `FFMPEG_PATH` points on a developer machine. */
const FFMPEG = process.env['FFMPEG_PATH'] || 'ffmpeg';

/** Whether ffmpeg can be started at all; without it there is no video, and a test skips. */
export function ffmpegAvailable(): boolean {
  return spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Eases the page from top to bottom over `duration`, re-reading the height every frame because
 * lazy content grows the page while it scrolls. A string, because it runs in the page.
 */
const SCROLL = (duration: number) => `new Promise((resolve) => {
  const start = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const height = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const frame = (now) => {
    const t = Math.min(1, (now - start) / ${duration});
    window.scrollTo(0, Math.max(0, height() - window.innerHeight) * ease(t));
    if (t < 1) requestAnimationFrame(frame); else resolve();
  };
  requestAnimationFrame(frame);
})`;

export interface RecordOptions {
  /** A's context options without the density: the video is recorded at DPR 1. */
  readonly context: BrowserContextOptions;
  /** A's cookies and storage, so the consent given there holds and no banner returns. */
  readonly storageState: BrowserContextOptions['storageState'];
}

/**
 * Records the page scrolling once from top to bottom and returns it as H.264 MP4 (0011 release
 * 3). Context B starts from A's state, so the consent is already given and every animation fires
 * fresh. The recording begins with the page; the load is cut off at the moment the scroll starts.
 *
 * Throws on any failure; the caller decides that a capture without a video is still a capture.
 */
export async function recordScrollVideo(
  browser: Browser,
  url: string,
  options: RecordOptions,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mb-scroll-'));
  try {
    const { width, height } = options.context.viewport ?? { width: 1440, height: 900 };
    const context = await browser.newContext({
      ...options.context,
      deviceScaleFactor: 1,
      storageState: options.storageState,
      recordVideo: { dir, size: { width, height } },
    });
    let webm: string;
    let scrollAt: number;
    try {
      const page = await context.newPage();
      const recordingFrom = Date.now();
      await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {
        // As in context A: a page that never goes quiet is still worth recording.
      });
      scrollAt = (Date.now() - recordingFrom) / 1000;
      await page.evaluate(SCROLL(SCROLL_DURATION_MS));
      await page.waitForTimeout(HOLD_MS);
      const video = page.video();
      if (!video) {
        throw new Error('The context recorded no video');
      }
      // The file is complete only once the context is closed.
      await context.close();
      webm = await video.path();
    } finally {
      await context.close().catch(() => undefined);
    }
    return await transcode(webm, join(dir, 'capture.mp4'), scrollAt, (SCROLL_DURATION_MS + HOLD_MS) / 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** WebM from Playwright to H.264 MP4 that every browser plays and can start before it has all of. */
async function transcode(input: string, output: string, start: number, duration: number): Promise<Buffer> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    // A little before the scroll, so its first frame is not lost to timing between the processes.
    '-ss',
    Math.max(0, start - 0.2).toFixed(2),
    '-i',
    input,
    '-t',
    duration.toFixed(2),
    '-an',
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    output,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), TRANSCODE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg ended with ${signal ?? `code ${code}`}: ${stderr.trim()}`));
      }
    });
  });
  return readFile(output);
}
