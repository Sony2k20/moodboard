import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * The subset of the Valkey client the api uses. Narrow on purpose: tests hand in an in-memory
 * fake instead of starting a server.
 */
export type ValkeyClient = Pick<
  Redis,
  | 'get'
  | 'set'
  | 'getdel'
  | 'del'
  | 'expire'
  | 'sadd'
  | 'smembers'
  | 'incr'
  | 'ttl'
  | 'multi'
>;

export const VALKEY = Symbol('VALKEY');

@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      useFactory: (): Redis => {
        const client = new Redis({
          host: process.env['VALKEY_HOST'] ?? 'localhost',
          port: Number(process.env['VALKEY_PORT'] ?? 6379),
          // Connect on first command, so the api starts — and serves its health endpoint — while
          // Valkey is still coming up.
          lazyConnect: true,
          maxRetriesPerRequest: 2,
        });
        // Without a listener ioredis reports every reconnect attempt as an unhandled error. One
        // line per outage is enough; the failing request carries the rest.
        const logger = new Logger('Valkey');
        let reported = false;
        client.on('error', (error: Error) => {
          if (!reported) {
            logger.warn(`Valkey unreachable: ${error.message || error.name}`);
            reported = true;
          }
        });
        client.on('ready', () => {
          reported = false;
        });
        return client;
      },
    },
  ],
  exports: [VALKEY],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.valkey.quit().catch(() => undefined);
  }
}
