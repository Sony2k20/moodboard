import {
  PutOptions,
  StorageService,
  StoredObject,
} from '@moodboard/shared';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';

export interface HostPathStorageOptions {
  /** The mounted HostPath root, chart default `/srv/moodboard/assets` (§4.2). */
  readonly root: string;
  /** URL prefix the API serves these files under. */
  readonly urlPrefix?: string;
}

/**
 * The HostPath adapter (concept §4.2).
 *
 * Files sit in plain sight on the node's filesystem, so they are inspectable and backed up with
 * existing tooling. Two things about the environment are worth remembering here rather than
 * rediscovering later:
 *
 *   * The directory must be owned by the UID the container runs as (1000 by the chart default).
 *     `fsGroup` has no effect on `hostPath` — Kubernetes accepts the setting and ignores it — so
 *     a `chown` on the node is the only thing that makes writes work. The failure mode is nasty:
 *     the pod starts perfectly cleanly and only the first upload fails with `EACCES`.
 *   * `api` and `worker` are pinned to the same node via `nodeAffinity`, because the worker writes
 *     what the API serves.
 */
export class HostPathStorageService implements StorageService {
  private readonly root: string;
  private readonly urlPrefix: string;

  constructor(options: HostPathStorageOptions) {
    this.root = resolve(options.root);
    this.urlPrefix = options.urlPrefix ?? '/files';
  }

  async put(
    path: string,
    data: Uint8Array | AsyncIterable<Uint8Array>,
    _options: PutOptions = {},
  ): Promise<StoredObject> {
    const target = this.toHostPath(path);
    await mkdir(dirname(target), { recursive: true });

    if (data instanceof Uint8Array) {
      await writeFile(target, data);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of data) {
        chunks.push(chunk);
      }
      await writeFile(target, Buffer.concat(chunks));
    }

    const stats = await stat(target);
    return { path, bytes: stats.size, modifiedAt: stats.mtime };
  }

  async get(path: string): Promise<AsyncIterable<Uint8Array>> {
    const target = this.toHostPath(path);
    // Fail here rather than mid-stream, so a caller sees a missing file as a rejected promise.
    await stat(target);
    return createReadStream(target);
  }

  async stat(path: string): Promise<StoredObject | null> {
    try {
      const stats = await stat(this.toHostPath(path));
      return { path, bytes: stats.size, modifiedAt: stats.mtime };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    // `force` keeps cleanup idempotent: a retried job must not fail on an already deleted file.
    await rm(this.toHostPath(path), { force: true });
  }

  async deleteAsset(assetId: string): Promise<void> {
    await rm(this.toHostPath(assetId), { recursive: true, force: true });
  }

  url(path: string): string {
    return posix.join(this.urlPrefix, path);
  }

  /**
   * Resolves a storage key against the root and refuses anything that escapes it. The worker
   * loads arbitrary third-party websites by design (§4.2), so a path derived from foreign input
   * must never be able to reach outside the mount.
   */
  private toHostPath(key: string): string {
    if (!key || key.startsWith('/') || key.includes('\0')) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }

    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return target;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
