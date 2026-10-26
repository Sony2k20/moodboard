import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPathStorageService } from './host-path-storage.service';

const ASSET = '11111111-2222-3333-4444-555555555555';

describe('HostPathStorageService', () => {
  let root: string;
  let storage: HostPathStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'moodboard-storage-'));
    storage = new HostPathStorageService({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes, reads, stats and deletes an object', async () => {
    const payload = new TextEncoder().encode('hello');
    const stored = await storage.put(`${ASSET}/original.png`, payload);
    expect(stored.bytes).toBe(5);

    const chunks: Uint8Array[] = [];
    for await (const chunk of await storage.get(`${ASSET}/original.png`)) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello');

    expect(await storage.stat(`${ASSET}/original.png`)).not.toBeNull();
    await storage.delete(`${ASSET}/original.png`);
    expect(await storage.stat(`${ASSET}/original.png`)).toBeNull();
  });

  it('deletes everything belonging to one asset', async () => {
    await storage.put(`${ASSET}/thumb-sm.webp`, new Uint8Array([1]));
    await storage.put(`${ASSET}/frames/01.webp`, new Uint8Array([1]));

    await storage.deleteAsset(ASSET);

    expect(await storage.stat(`${ASSET}/frames/01.webp`)).toBeNull();
  });

  it('stays idempotent when deleting something that is already gone', async () => {
    await expect(storage.delete(`${ASSET}/nope.webp`)).resolves.toBeUndefined();
    await expect(storage.deleteAsset(ASSET)).resolves.toBeUndefined();
  });

  it('refuses keys that escape the storage root', async () => {
    // The worker loads arbitrary third-party websites by design (§4.2), so a key derived from
    // foreign input must never reach outside the mount.
    for (const key of ['../escape.webp', `${ASSET}/../../escape.webp`, '/abs']) {
      await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow();
    }
  });
});
