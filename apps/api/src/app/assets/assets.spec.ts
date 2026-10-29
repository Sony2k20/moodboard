import {
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssetsController } from './assets.controller';
import { AssetsService, titleFromFileName } from './assets.service';
import { FilesController } from './files.controller';

const user = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'A',
  role: 'member' as const,
  locale: 'en' as const,
};
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

function upload(buffer: Buffer, originalname = 'shot.png') {
  return { buffer, originalname } as Express.Multer.File;
}

describe('AssetsController.upload', () => {
  const ingestUpload = jest.fn(async () => ({ id: 'new-id', enqueued: true }));
  const controller = new AssetsController({
    ingestUpload,
  } as unknown as AssetsService);

  beforeEach(() => ingestUpload.mockClear());

  it('accepts by content and passes the detected format on', async () => {
    await expect(
      controller.upload(upload(PNG, 'renamed.jpg'), user),
    ).resolves.toEqual({ id: 'new-id' });
    expect(ingestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'png', userId: 'u1' }),
    );
  });

  it('refuses a text file named .png with 415, before anything is stored', async () => {
    await expect(
      controller.upload(upload(Buffer.from('not an image'), 'evil.png'), user),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(ingestUpload).not.toHaveBeenCalled();
  });

  it('refuses SVG', async () => {
    await expect(
      controller.upload(
        upload(
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          'logo.svg',
        ),
        user,
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
});

describe('titleFromFileName', () => {
  it('uses the file name without its extension', () => {
    expect(titleFromFileName('Stripe pricing page.png')).toBe(
      'Stripe pricing page',
    );
  });

  it('ignores the generic names browsers give pasted images', () => {
    expect(titleFromFileName('image.png')).toBeNull();
    expect(titleFromFileName('blob')).toBeNull();
    expect(titleFromFileName(undefined)).toBeNull();
  });
});

describe('FilesController', () => {
  const storage = { stat: jest.fn(async () => null), get: jest.fn() };
  const controller = new FilesController(storage as never);
  const res = {} as Response;
  const id = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => storage.stat.mockClear());

  it.each([
    ['not-a-uuid', 'thumb-sm.webp'],
    [id, '..%2F..%2Fetc%2Fpasswd'],
    [id, 'secret.txt'],
    [id, 'original.svg'],
  ])(
    'answers 404 for %s/%s without touching storage',
    async (assetId, file) => {
      await expect(controller.file(assetId, file, res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.stat).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a well-formed path that does not exist', async () => {
    await expect(
      controller.file(id, 'thumb-sm.webp', res),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.stat).toHaveBeenCalledWith(`${id}/thumb-sm.webp`);
  });
});
