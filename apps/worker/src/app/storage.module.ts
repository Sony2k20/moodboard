import { Global, Module } from '@nestjs/common';
import { STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import { HostPathStorageService } from '@moodboard/storage';

/** The storage port (§4.2). The adapter is chosen here, nowhere else. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (): StorageService =>
        new HostPathStorageService({
          root: process.env['STORAGE_ROOT'] || './.storage',
        }),
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
