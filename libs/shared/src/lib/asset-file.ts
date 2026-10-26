import { z } from 'zod';

/** The file kinds an asset can carry, mirroring `asset_file.kind` (concept §5.1). */
export const ASSET_FILE_KINDS = [
  'original',
  'thumb_sm',
  'thumb_md',
  'thumb_lg',
  'capture',
  'poster',
  'frame',
] as const;

export const AssetFileKindSchema = z.enum(ASSET_FILE_KINDS);
export type AssetFileKind = z.infer<typeof AssetFileKindSchema>;

export const ASSET_STATUSES = ['pending', 'ready', 'failed'] as const;
export const AssetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

/**
 * Who set a piece of metadata (concept §5.6).
 *
 * `human` always wins over `ai`, enforced by database triggers rather than application logic. A
 * re-analysis must never overwrite a human correction.
 */
export const ORIGINS = ['ai', 'human'] as const;
export const OriginSchema = z.enum(ORIGINS);
export type Origin = z.infer<typeof OriginSchema>;

export const USER_ROLES = ['admin', 'member'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * The storage layout from concept §4.2, relative to the storage root:
 *
 * ```
 * <asset-id>/original.<ext>
 * <asset-id>/thumb-{sm,md,lg}.webp
 * <asset-id>/capture.webm
 * <asset-id>/poster.webp
 * <asset-id>/frames/NN.webp
 * ```
 *
 * Paths are built here and nowhere else, so the layout is changed in one place. Always forward
 * slashes: these are storage keys, not host paths, and the S3 adapter would take them verbatim.
 */
export function assetFilePath(
  assetId: string,
  kind: AssetFileKind,
  options: { extension?: string; frameIndex?: number } = {},
): string {
  switch (kind) {
    case 'original': {
      const extension = options.extension?.replace(/^\./, '');
      if (!extension) {
        throw new Error('An original needs its file extension');
      }
      return `${assetId}/original.${extension}`;
    }
    case 'thumb_sm':
      return `${assetId}/thumb-sm.webp`;
    case 'thumb_md':
      return `${assetId}/thumb-md.webp`;
    case 'thumb_lg':
      return `${assetId}/thumb-lg.webp`;
    case 'capture':
      return `${assetId}/capture.webm`;
    case 'poster':
      return `${assetId}/poster.webp`;
    case 'frame': {
      const index = options.frameIndex;
      if (index === undefined) {
        throw new Error('A frame needs its index');
      }
      return `${assetId}/frames/${String(index).padStart(2, '0')}.webp`;
    }
  }
}
