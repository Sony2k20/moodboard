import { sniffFontFormat } from './font';
import { nextPipelineStep, pipelineKindOf } from './pipeline';

describe('sniffFontFormat', () => {
  const head = (...bytes: number[]) => new Uint8Array([...bytes, 0, 0, 0, 0]);
  const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));

  it('knows the four formats by their first bytes', () => {
    expect(sniffFontFormat(ascii('wOF2xxxx'))).toBe('woff2');
    expect(sniffFontFormat(ascii('wOFFxxxx'))).toBe('woff');
    expect(sniffFontFormat(ascii('OTTOxxxx'))).toBe('otf');
    expect(sniffFontFormat(head(0, 1, 0, 0))).toBe('ttf');
    expect(sniffFontFormat(ascii('truexxxx'))).toBe('ttf');
  });

  it('refuses collections, images and short files', () => {
    expect(sniffFontFormat(ascii('ttcfxxxx'))).toBeNull();
    expect(sniffFontFormat(head(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffFontFormat(ascii('wO'))).toBeNull();
  });
});

describe('the font pipeline', () => {
  it('starts with the specimen and ends with the classification', () => {
    expect(pipelineKindOf('font')).toBe('font');
    expect(nextPipelineStep('specimen', 'font')).toBe('thumbnails');
    expect(nextPipelineStep('colors', 'font')).toBe('classify');
    expect(nextPipelineStep('classify', 'font')).toBeNull();
  });
});
