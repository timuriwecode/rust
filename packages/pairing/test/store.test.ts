import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePushMessage } from '../src/notification.ts';
import { ConfigStore, defaultConfigDir } from '../src/store.ts';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'rcomp-test-'));
  return new ConfigStore(join(dir, 'config.json'));
}

const pairing = (body: Record<string, unknown>) =>
  parsePushMessage({
    appData: [
      { key: 'channelId', value: 'pairing' },
      { key: 'body', value: JSON.stringify({ playerId: '76561198000000123', playerToken: '42', name: 'Srv', ...body }) },
    ],
  });

describe('ConfigStore', () => {
  it('stores servers and entities from pairing events', () => {
    const store = tempStore();
    expect(store.apply(pairing({ type: 'server', id: 'relay-1', ip: '1.2.3.4', port: '28082' }))).toBe(true);
    store.apply(pairing({ type: 'entity', id: 'relay-1', entityId: '99', entityType: '1', entityName: 'Switch' }));
    const server = store.resolveServer();
    expect(server?.key).toBe('relay-1');
    expect(server?.entities['99']?.entityName).toBe('Switch');
    expect(store.resolveServer('srv')?.key).toBe('relay-1');
  });

  it('re-keys a server paired before the relay id existed and keeps its devices', () => {
    const store = tempStore();
    store.apply(pairing({ type: 'server', ip: '1.2.3.4', port: '28082' }));
    store.apply(pairing({ type: 'entity', ip: '1.2.3.4', port: '28082', entityId: '7', entityType: '2' }));
    expect(Object.keys(store.config.servers)).toEqual(['1.2.3.4:28082']);

    store.apply(pairing({ type: 'server', id: 'relay-xyz', ip: '1.2.3.4', port: '28082' }));
    expect(Object.keys(store.config.servers)).toEqual(['relay-xyz']);
    expect(store.config.servers['relay-xyz']?.entities['7']).toBeDefined();
  });

  it('saves with restrictive permissions and reloads', () => {
    const store = tempStore();
    store.apply(pairing({ type: 'server', id: 'relay-1' }));
    store.rememberPersistentId('abc');
    store.save();
    if (process.platform !== 'win32') expect(statSync(store.path).mode & 0o777).toBe(0o600);
    const again = new ConfigStore(store.path);
    expect(again.config.servers['relay-1']?.name).toBe('Srv');
    expect(again.config.persistentIds).toEqual(['abc']);
    expect(JSON.parse(readFileSync(store.path, 'utf8')).version).toBe(1);
  });

  it('imports a rustplus.js config file', () => {
    const store = tempStore();
    const token = `${Buffer.from('{"steamId":"76561198000000123","exp":4102444800}').toString('base64url')}.sig`;
    store.importRustplusJsConfig({
      fcm_credentials: { gcm: { androidId: '111', securityToken: '222' }, fcm: { token: 'fcm-token' } },
      expo_push_token: 'ExponentPushToken[x]',
      rustplus_auth_token: token,
    });
    expect(store.config.fcm).toEqual({ androidId: '111', securityToken: '222', fcmToken: 'fcm-token', expoPushToken: 'ExponentPushToken[x]' });
    expect(store.config.auth?.steamId).toBe('76561198000000123');
  });

  it('rejects an invalid auth token', () => {
    expect(() => tempStore().setAuthToken('nope')).toThrow();
  });

  it('honours RCOMP_HOME', () => {
    expect(defaultConfigDir({ RCOMP_HOME: '/x/y' })).toBe('/x/y');
  });
});
