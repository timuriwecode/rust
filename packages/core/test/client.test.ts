import { afterEach, describe, expect, it } from 'vitest';
import { connectionTarget, RustPlusClient } from '../src/client.ts';
import { HandshakeError, NotConnectedError, RequestTimeoutError, RustPlusError } from '../src/errors.ts';
import { FAKE_PLAYER, FAKE_TEAMMATE_ID, FakeRustServer } from '../src/testing/fake-server.ts';
import { EntityType, MarkerType, type EntityChangedBroadcast, type TeamMessage } from '../src/types.ts';

let server: FakeRustServer;
let client: RustPlusClient | undefined;

async function startDirect(options: ConstructorParameters<typeof FakeRustServer>[0] = {}) {
  server = new FakeRustServer({ player: FAKE_PLAYER, ...options });
  await server.start();
  client = new RustPlusClient({
    endpoint: { kind: 'direct', host: '127.0.0.1', port: server.port },
    ...FAKE_PLAYER,
    rateLimiter: null,
    requestTimeoutMs: 2000,
  });
  await client.connect();
  return client;
}

function nextEvent<T>(emitter: RustPlusClient, event: 'teamMessage' | 'entityChanged' | 'teamChanged' | 'disconnected'): Promise<T> {
  return new Promise((resolve) => emitter.once(event as any, (arg: any) => resolve(arg as T)));
}

afterEach(async () => {
  client?.disconnect();
  client = undefined;
  await server?.stop();
});

describe('connectionTarget', () => {
  it('builds the relay URL, subprotocols and origin', () => {
    const target = connectionTarget({ kind: 'relay', serverId: 'abc-123', authToken: 'tok' }, 1000);
    expect(target.url).toBe('wss://companion-rust.facepunch.com/socket/abc-123?v=1000');
    expect(target.protocols).toEqual(['rustplus.auth.v1', 'dG9r']);
    expect(target.headers).toEqual({ Origin: 'https://app.playrust.com' });
  });

  it('builds a direct URL', () => {
    expect(connectionTarget({ kind: 'direct', host: '1.2.3.4', port: 28082 }).url).toBe('ws://1.2.3.4:28082');
  });
});

describe('RustPlusClient against the fake server', () => {
  it('reads server info, time, team, chat, markers and map', async () => {
    const c = await startDirect();
    const info = await c.getInfo();
    expect(info.name).toBe('Fake Rust Server');
    expect(info.mapSize).toBe(3500);

    const time = await c.getTime();
    expect(time.time).toBeCloseTo(12.5);

    const team = await c.getTeamInfo();
    expect(team.leaderSteamId).toBe(FAKE_PLAYER.playerId);
    expect(team.members.map((m) => m.name)).toEqual(['You', 'Teammate']);

    const chat = await c.getTeamChat();
    expect(chat[0]?.message).toBe('heading to outpost');

    const markers = await c.getMapMarkers();
    expect(markers.filter((m) => m.type === MarkerType.Player)).toHaveLength(2);

    const map = await c.getMap();
    expect(map.monuments.map((m) => m.token)).toContain('outpost');
    expect(map.jpgImage[0]).toBe(0xff);
  });

  it('reads and toggles smart devices and receives entityChanged', async () => {
    const c = await startDirect();
    const monitor = await c.getEntityInfo('1003');
    expect(monitor.type).toBe(EntityType.StorageMonitor);
    expect(monitor.payload.hasProtection).toBe(true);
    expect(monitor.payload.items).toHaveLength(2);

    const changed = nextEvent<EntityChangedBroadcast>(c, 'entityChanged');
    await c.setEntityValue('1001', true);
    expect(await changed).toEqual({ entityId: '1001', payload: { value: true, items: [] } });
    expect((await c.getEntityInfo('1001')).payload.value).toBe(true);
  });

  it('turns server errors into RustPlusError', async () => {
    const c = await startDirect();
    await expect(c.getEntityInfo('999')).rejects.toEqual(new RustPlusError('not_found', 'getEntityInfo'));
    await expect(c.setEntityValue('1002', true)).rejects.toBeInstanceOf(RustPlusError);
  });

  it('reports wrong credentials as an error from the server', async () => {
    server = new FakeRustServer({ player: FAKE_PLAYER });
    await server.start();
    client = new RustPlusClient({
      endpoint: { kind: 'direct', host: '127.0.0.1', port: server.port },
      playerId: FAKE_PLAYER.playerId,
      playerToken: 1,
      rateLimiter: null,
    });
    await client.connect();
    await expect(client.getInfo()).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('emits broadcasts for team chat and team changes', async () => {
    const c = await startDirect();
    const message = nextEvent<TeamMessage>(c, 'teamMessage');
    server.postTeamMessage('Teammate', 'raid at G12');
    expect((await message).message).toBe('raid at G12');

    const own = nextEvent<TeamMessage>(c, 'teamMessage');
    await c.sendTeamMessage('omw');
    expect((await own).message).toBe('omw');

    const teamChanged = nextEvent<any>(c, 'teamChanged');
    server.updateTeamMember(FAKE_TEAMMATE_ID, { isAlive: false });
    const event = await teamChanged;
    expect(event.teamInfo.members[1].isAlive).toBe(false);
  });

  it('records requests and incoming messages through events', async () => {
    const c = await startDirect();
    const names: string[] = [];
    let messages = 0;
    c.on('request', (name) => names.push(name));
    c.on('message', () => messages++);
    await c.getInfo();
    await c.getEntityInfo('1001');
    expect(names).toEqual(['getInfo', 'getEntityInfo']);
    expect(messages).toBe(2);
  });

  it('rejects pending requests and emits disconnected when the connection drops', async () => {
    const c = await startDirect();
    const disconnected = nextEvent<number>(c, 'disconnected');
    server.dropConnections();
    await disconnected;
    expect(c.connected).toBe(false);
    await expect(c.getInfo()).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('times out when the server does not answer', async () => {
    server = new FakeRustServer();
    await server.start();
    (server as any).handle = () => undefined;
    client = new RustPlusClient({
      endpoint: { kind: 'direct', host: '127.0.0.1', port: server.port },
      ...FAKE_PLAYER,
      rateLimiter: null,
      requestTimeoutMs: 100,
    });
    await client.connect();
    await expect(client.getTime()).rejects.toBeInstanceOf(RequestTimeoutError);
  });
});

describe('relay handshake', () => {
  it('connects when the auth token subprotocol matches', async () => {
    server = new FakeRustServer({ relayAuthToken: 'good-token' });
    await server.start();
    client = new RustPlusClient({
      endpoint: { kind: 'relay', serverId: 'srv', authToken: 'good-token', host: `127.0.0.1:${server.port}`, secure: false },
      ...FAKE_PLAYER,
      rateLimiter: null,
    });
    await client.connect();
    expect((await client.getInfo()).name).toBe('Fake Rust Server');
  });

  it('fails with HandshakeError when the token is refused', async () => {
    server = new FakeRustServer({ relayAuthToken: 'good-token' });
    await server.start();
    client = new RustPlusClient({
      endpoint: { kind: 'relay', serverId: 'srv', authToken: 'bad-token', host: `127.0.0.1:${server.port}`, secure: false },
      ...FAKE_PLAYER,
      rateLimiter: null,
    });
    const error = await client.connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HandshakeError);
    expect((error as HandshakeError).status).toBe(401);
  });
});
