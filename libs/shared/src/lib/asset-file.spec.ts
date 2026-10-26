import { assetFilePath } from './asset-file';

const ASSET = '11111111-2222-3333-4444-555555555555';

describe('assetFilePath', () => {
  it('builds the layout from §4.2', () => {
    expect(assetFilePath(ASSET, 'original', { extension: 'png' })).toBe(
      `${ASSET}/original.png`,
    );
    expect(assetFilePath(ASSET, 'thumb_md')).toBe(`${ASSET}/thumb-md.webp`);
    expect(assetFilePath(ASSET, 'capture')).toBe(`${ASSET}/capture.webm`);
    expect(assetFilePath(ASSET, 'poster')).toBe(`${ASSET}/poster.webp`);
    expect(assetFilePath(ASSET, 'frame', { frameIndex: 7 })).toBe(
      `${ASSET}/frames/07.webp`,
    );
  });

  it('tolerates a leading dot on the extension', () => {
    expect(assetFilePath(ASSET, 'original', { extension: '.jpg' })).toBe(
      `${ASSET}/original.jpg`,
    );
  });

  it('refuses an original without an extension and a frame without an index', () => {
    expect(() => assetFilePath(ASSET, 'original')).toThrow();
    expect(() => assetFilePath(ASSET, 'frame')).toThrow();
  });
});
