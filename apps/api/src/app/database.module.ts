import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, Database, DatabaseHandle } from '@moodboard/db';

export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      useFactory: (): DatabaseHandle => createDatabase(),
    },
    {
      provide: DATABASE,
      useFactory: (handle: DatabaseHandle): Database => handle.db,
      inject: [DATABASE_HANDLE],
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
