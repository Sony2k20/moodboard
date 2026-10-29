import { FakeValkey } from '../testing/fake-valkey';
import {
  EMERGENCY_SESSION_SECONDS,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_SLIDING_SECONDS,
  SessionStore,
} from './session.store';

const DAY = 24 * 60 * 60 * 1000;

describe('SessionStore', () => {
  let clock: number;
  let valkey: FakeValkey;
  let store: SessionStore;

  beforeEach(() => {
    clock = Date.UTC(2026, 9, 29);
    valkey = new FakeValkey(() => clock);
    store = new SessionStore(valkey.asClient());
    store.now = () => clock;
  });

  const user = {
    userId: 'u1',
    sub: 'sub-1',
    sid: 'sid-1',
    idToken: 'id',
    emergency: false,
  };

  it('round-trips a session by its token', async () => {
    const { token, maxAgeSeconds } = await store.create(user);
    expect(maxAgeSeconds).toBe(SESSION_ABSOLUTE_SECONDS);
    await expect(store.get(token)).resolves.toMatchObject({
      userId: 'u1',
      sid: 'sid-1',
    });
  });

  it('never stores the token itself', async () => {
    const { token } = await store.create(user);
    const everything = JSON.stringify([
      ...valkey.strings.entries(),
      ...[...valkey.sets.values()].map((s) => [...s]),
    ]);
    expect(everything).not.toContain(token);
  });

  it('rejects unknown and missing tokens', async () => {
    await store.create(user);
    await expect(store.get('not-a-token')).resolves.toBeNull();
    await expect(store.get(undefined)).resolves.toBeNull();
  });

  it('expires after the sliding window without use', async () => {
    const { token } = await store.create(user);
    clock += SESSION_SLIDING_SECONDS * 1000 + 1000;
    await expect(store.get(token)).resolves.toBeNull();
  });

  it('slides while in use, but never past the absolute limit', async () => {
    const { token } = await store.create(user);
    for (let day = 0; day < 29; day++) {
      clock += DAY;
      await expect(store.get(token)).resolves.not.toBeNull();
    }
    clock += DAY;
    await expect(store.get(token)).resolves.toBeNull();
  });

  it('gives the emergency admin a short session that does not slide', async () => {
    const { token, maxAgeSeconds } = await store.create({
      userId: 'admin',
      sub: 'local:emergency-admin',
      emergency: true,
    });
    expect(maxAgeSeconds).toBe(EMERGENCY_SESSION_SECONDS);
    clock += (EMERGENCY_SESSION_SECONDS - 60) * 1000;
    await expect(store.get(token)).resolves.not.toBeNull();
    clock += 120 * 1000;
    await expect(store.get(token)).resolves.toBeNull();
  });

  it('destroys a session on logout', async () => {
    const { token } = await store.create(user);
    await expect(store.destroy(token)).resolves.toMatchObject({ userId: 'u1' });
    await expect(store.get(token)).resolves.toBeNull();
  });

  describe('backchannel logout', () => {
    it('ends the sessions of that sid only', async () => {
      const a = await store.create(user);
      const b = await store.create({ ...user, sid: 'sid-2' });
      await expect(
        store.destroyByLogout({ sid: 'sid-1', sub: 'sub-1' }),
      ).resolves.toBe(1);
      await expect(store.get(a.token)).resolves.toBeNull();
      await expect(store.get(b.token)).resolves.not.toBeNull();
    });

    it('ends every session of the subject when no sid is given', async () => {
      const a = await store.create(user);
      const b = await store.create({ ...user, sid: 'sid-2' });
      const other = await store.create({
        ...user,
        userId: 'u2',
        sub: 'sub-2',
        sid: 'sid-3',
      });
      await expect(store.destroyByLogout({ sub: 'sub-1' })).resolves.toBe(2);
      await expect(store.get(a.token)).resolves.toBeNull();
      await expect(store.get(b.token)).resolves.toBeNull();
      await expect(store.get(other.token)).resolves.not.toBeNull();
    });

    it('cannot reach the emergency admin, which has no OIDC session', async () => {
      const emergency = await store.create({
        userId: 'admin',
        sub: 'local:emergency-admin',
        emergency: true,
      });
      await expect(
        store.destroyByLogout({ sub: 'local:emergency-admin' }),
      ).resolves.toBe(0);
      await expect(store.get(emergency.token)).resolves.not.toBeNull();
    });
  });

  describe('login flow', () => {
    const flow = { codeVerifier: 'v', nonce: 'n', returnTo: '/x' };

    it('can be redeemed exactly once', async () => {
      await store.saveLoginFlow('state', flow);
      await expect(store.takeLoginFlow('state')).resolves.toEqual(flow);
      await expect(store.takeLoginFlow('state')).resolves.toBeNull();
    });

    it('expires after ten minutes', async () => {
      await store.saveLoginFlow('state', flow);
      clock += 10 * 60 * 1000 + 1;
      await expect(store.takeLoginFlow('state')).resolves.toBeNull();
    });
  });
});
