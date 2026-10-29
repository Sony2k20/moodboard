import { sniffUploadFormat } from './sniff-format';

const bytes = (...values: Array<number | string>) =>
  new Uint8Array(
    values.flatMap((v) =>
      typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v],
    ),
  );

describe('sniffUploadFormat', () => {
  it.each([
    ['png', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)],
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['gif', bytes('GIF89a', 1, 0)],
    ['gif', bytes('GIF87a')],
    ['webp', bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ')],
  ])('recognises %s from its content', (format, data) => {
    expect(sniffUploadFormat(data)).toBe(format);
  });

  it.each([
    ['plain text', bytes('hello, this is not an image')],
    ['an SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['a RIFF that is not WebP', bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt ')],
    ['a truncated PNG signature', bytes(0x89, 'PN')],
    ['nothing', bytes()],
  ])('refuses %s', (_, data) => {
    expect(sniffUploadFormat(data)).toBeNull();
  });
});
