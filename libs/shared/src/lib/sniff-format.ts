import { UploadFormat } from './pipeline';

/**
 * Identifies an upload by its leading bytes (0004). The name and the `Content-Type` are chosen by
 * the client and prove nothing; these signatures are what the decoders themselves check first.
 *
 * This is the cheap gate in the api, so a `.txt` renamed to `.png` never reaches storage. The
 * worker's `normalize` step then decodes the whole file — a file that passes here but is broken
 * further in fails there and marks the asset `failed`.
 */
export function sniffUploadFormat(bytes: Uint8Array): UploadFormat | null {
  const starts = (signature: readonly number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, i) => bytes[offset + i] === byte);
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (starts([0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  if (starts(ascii('GIF87a')) || starts(ascii('GIF89a'))) {
    return 'gif';
  }
  if (starts(ascii('RIFF')) && starts(ascii('WEBP'), 8)) {
    return 'webp';
  }
  return null;
}
