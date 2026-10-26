/**
 * The storage port (concept §4.2, §2).
 *
 * It exists from day one because retrofitting it means touching every file access in the
 * codebase. Phase 1 ships exactly one adapter, for the HostPath volume; moving to S3/MinIO later
 * is then an adapter swap plus a data migration, not a redesign.
 *
 * Deliberately narrow and declared without Node types, so this interface stays importable from
 * the Angular bundle: `Uint8Array` and `AsyncIterable` instead of `Buffer` and `Readable`.
 * `path` is always a storage key as built by `assetFilePath`, never a host path.
 */
export interface StoredObject {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: Date;
}

export interface PutOptions {
  /** Content type to record or to set on the object, e.g. `image/webp`. */
  readonly mime?: string;
}

export interface StorageService {
  /** Writes an object, overwriting an existing one at the same path. */
  put(
    path: string,
    data: Uint8Array | AsyncIterable<Uint8Array>,
    options?: PutOptions,
  ): Promise<StoredObject>;

  /** Reads an object as a stream. Rejects when the path does not exist. */
  get(path: string): Promise<AsyncIterable<Uint8Array>>;

  /** Metadata without reading the payload. `null` when the path does not exist. */
  stat(path: string): Promise<StoredObject | null>;

  /** Removes an object. Succeeds when it was already gone, so cleanup stays idempotent. */
  delete(path: string): Promise<void>;

  /** Removes everything belonging to one asset — the `<asset-id>/` prefix. */
  deleteAsset(assetId: string): Promise<void>;

  /**
   * The URL the API serves this object under. Relative for the HostPath adapter, absolute and
   * possibly pre-signed for an object-store adapter later.
   */
  url(path: string): string;
}

/** DI token, so the adapter is selected by configuration rather than by import. */
export const STORAGE_SERVICE = 'STORAGE_SERVICE';
