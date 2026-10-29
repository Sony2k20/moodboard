import { ValkeyClient } from '../valkey.module';

/**
 * In-memory stand-in for the commands the api uses. Expiry follows the injected clock, so tests
 * can move time instead of waiting.
 */
export class FakeValkey {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly expiries = new Map<string, number>();

  constructor(public now: () => number = Date.now) {}

  asClient(): ValkeyClient {
    return this as unknown as ValkeyClient;
  }

  private alive(key: string): boolean {
    const at = this.expiries.get(key);
    if (at !== undefined && at <= this.now()) {
      this.strings.delete(key);
      this.sets.delete(key);
      this.expiries.delete(key);
      return false;
    }
    return this.strings.has(key) || this.sets.has(key);
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key) ? (this.strings.get(key) ?? null) : null;
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    seconds?: number,
  ): Promise<'OK'> {
    this.strings.set(key, value);
    if (mode === 'EX' && seconds !== undefined) {
      this.expiries.set(key, this.now() + seconds * 1000);
    } else {
      this.expiries.delete(key);
    }
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    const value = await this.get(key);
    await this.del(key);
    return value;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.alive(key)) {
        removed++;
      }
      this.strings.delete(key);
      this.sets.delete(key);
      this.expiries.delete(key);
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.alive(key)) {
      return 0;
    }
    this.expiries.set(key, this.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    if (!this.alive(key)) {
      return -2;
    }
    const at = this.expiries.get(key);
    return at === undefined ? -1 : Math.ceil((at - this.now()) / 1000);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.alive(key);
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    members.forEach((m) => set.add(m));
    this.sets.set(key, set);
    return set.size - before;
  }

  async smembers(key: string): Promise<string[]> {
    return this.alive(key) ? [...(this.sets.get(key) ?? [])] : [];
  }

  async incr(key: string): Promise<number> {
    const next = Number((await this.get(key)) ?? 0) + 1;
    this.strings.set(key, String(next));
    return next;
  }

  multi() {
    const queued: Array<() => Promise<unknown>> = [];
    const chain = {
      set: (key: string, value: string, mode?: 'EX', seconds?: number) => {
        queued.push(() => this.set(key, value, mode, seconds));
        return chain;
      },
      sadd: (key: string, ...members: string[]) => {
        queued.push(() => this.sadd(key, ...members));
        return chain;
      },
      expire: (key: string, seconds: number) => {
        queued.push(() => this.expire(key, seconds));
        return chain;
      },
      exec: async () => {
        const results: Array<[null, unknown]> = [];
        for (const run of queued) {
          results.push([null, await run()]);
        }
        return results;
      },
    };
    return chain;
  }
}
