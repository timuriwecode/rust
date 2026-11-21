import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { RELAY_SUBPROTOCOL } from '../client.ts';
import { decodeRequest, encodeMessage, type Raw, type RawAppMessage } from '../protocol.ts';
import { EntityType, MarkerType } from '../types.ts';

/**
 * A local stand-in for a Rust+ server, speaking the same protobuf protocol.
 * Used by the tests and for developing the overlay without the game.
 * Response shapes follow the real protocol; error codes are illustrative.
 */

export interface FakeEntity {
  type: number;
  payload: Raw;
}

export interface FakeState {
  info: Raw;
  time: Raw;
  map: Raw;
  teamInfo: Raw;
  teamChat: Raw[];
  markers: Raw[];
  entities: Map<string, FakeEntity>;
  subscriptions: Set<string>;
}

export interface FakeServerOptions {
  port?: number;
  host?: string;
  /** When set, requests with other credentials get error "invalid_credentials". */
  player?: { playerId: string; playerToken: number };
  /** When set, the handshake must offer `rustplus.auth.v1` and this token (base64url). */
  relayAuthToken?: string;
  state?: Partial<FakeState>;
}

/** 1x1 grey JPEG. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

export const FAKE_PLAYER = { playerId: '76561190000000001', playerToken: 123456789 };
export const FAKE_TEAMMATE_ID = '76561190000000002';

export function defaultFakeState(nowSeconds = Math.floor(Date.now() / 1000)): FakeState {
  return {
    info: {
      name: 'Fake Rust Server',
      headerImage: '',
      url: 'https://example.invalid',
      map: 'Procedural Map',
      mapSize: 3500,
      wipeTime: nowSeconds - 2 * 86400,
      players: 42,
      maxPlayers: 200,
      queuedPlayers: 0,
      seed: 1337,
      salt: 7,
    },
    time: { dayLengthMinutes: 60, timeScale: 1, sunrise: 7.5, sunset: 19.75, time: 12.5 },
    map: {
      width: 1,
      height: 1,
      jpgImage: TINY_JPEG,
      oceanMargin: 500,
      monuments: [
        { token: 'oil_rig_small', x: 300, y: 3100 },
        { token: 'launchsite', x: 2600, y: 900 },
        { token: 'outpost', x: 1750, y: 1750 },
      ],
      background: '#12404D',
    },
    teamInfo: {
      leaderSteamId: FAKE_PLAYER.playerId,
      members: [
        { steamId: FAKE_PLAYER.playerId, name: 'You', x: 1200, y: 2100, isOnline: true, spawnTime: nowSeconds - 600, isAlive: true, deathTime: 0 },
        { steamId: FAKE_TEAMMATE_ID, name: 'Teammate', x: 1300, y: 2050, isOnline: true, spawnTime: nowSeconds - 300, isAlive: true, deathTime: nowSeconds - 320 },
      ],
      mapNotes: [],
      leaderMapNotes: [],
    },
    teamChat: [
      { steamId: FAKE_TEAMMATE_ID, name: 'Teammate', message: 'heading to outpost', color: '#5af', time: nowSeconds - 60 },
    ],
    markers: [
      { id: 1, type: MarkerType.Player, x: 1200, y: 2100, steamId: FAKE_PLAYER.playerId, name: 'You' },
      { id: 2, type: MarkerType.Player, x: 1300, y: 2050, steamId: FAKE_TEAMMATE_ID, name: 'Teammate' },
      { id: 3, type: MarkerType.CH47, x: 2000, y: 2500, rotation: 90 },
      { id: 4, type: MarkerType.Crate, x: 2600, y: 900 },
    ],
    entities: new Map<string, FakeEntity>([
      ['1001', { type: EntityType.Switch, payload: { value: false } }],
      ['1002', { type: EntityType.Alarm, payload: { value: false } }],
      [
        '1003',
        {
          type: EntityType.StorageMonitor,
          payload: {
            value: true,
            capacity: 24,
            hasProtection: true,
            protectionExpiry: nowSeconds + 5 * 3600,
            items: [
              { itemId: -151838493, quantity: 3000, itemIsBlueprint: false },
              { itemId: 69511070, quantity: 1500, itemIsBlueprint: false },
            ],
          },
        },
      ],
    ]),
    subscriptions: new Set(),
  };
}

export class FakeRustServer {
  readonly state: FakeState;
  /** Every decoded request, in order. */
  readonly requests: Raw[] = [];
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly options: FakeServerOptions = {}) {
    this.state = { ...defaultFakeState(), ...options.state };
  }

  get port(): number {
    const address = this.wss?.address() as AddressInfo | undefined;
    if (!address) throw new Error('Fake server is not running');
    return address.port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        port: this.options.port ?? 0,
        host: this.options.host ?? '127.0.0.1',
        handleProtocols: (protocols) => (protocols.has(RELAY_SUBPROTOCOL) ? RELAY_SUBPROTOCOL : false),
        verifyClient: (info, done) => {
          const expected = this.options.relayAuthToken;
          if (!expected) return done(true);
          const offered = String(info.req.headers['sec-websocket-protocol'] ?? '')
            .split(',')
            .map((p) => p.trim());
          const token = Buffer.from(expected, 'utf8').toString('base64url');
          if (offered.includes(RELAY_SUBPROTOCOL) && offered.includes(token)) return done(true);
          done(false, 401, 'Unauthorized');
        },
      });
      wss.once('listening', () => {
        this.wss = wss;
        resolve();
      });
      wss.once('error', reject);
      wss.on('connection', (socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('message', (data, isBinary) => {
          if (!isBinary) return;
          this.handle(socket, data as Buffer);
        });
      });
    });
  }

  stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    const wss = this.wss;
    this.wss = null;
    return new Promise((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
  }

  /** Closes all client connections (to test reconnect logic). */
  dropConnections(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  broadcast(broadcast: Raw): void {
    const bytes = encodeMessage({ broadcast });
    for (const socket of this.sockets) socket.send(bytes);
  }

  /** Adds a team chat message and broadcasts it, as if a teammate wrote it. */
  postTeamMessage(name: string, message: string, steamId = FAKE_TEAMMATE_ID): void {
    const entry = { steamId, name, message, color: '#5af', time: Math.floor(Date.now() / 1000) };
    this.state.teamChat.push(entry);
    this.broadcast({ teamMessage: { message: entry } });
  }

  /** Changes an entity and broadcasts entityChanged (e.g. a smart alarm going off). */
  setEntity(entityId: string, payload: Raw): void {
    const entity = this.state.entities.get(entityId);
    if (!entity) throw new Error(`No fake entity ${entityId}`);
    entity.payload = { ...entity.payload, ...payload };
    this.broadcast({ entityChanged: { entityId, payload: entity.payload } });
  }

  updateTeamMember(steamId: string, changes: Raw): void {
    const member = (this.state.teamInfo.members as Raw[]).find((m) => m.steamId === steamId);
    if (!member) throw new Error(`No fake team member ${steamId}`);
    Object.assign(member, changes);
    this.broadcast({ teamChanged: { playerId: FAKE_PLAYER.playerId, teamInfo: this.state.teamInfo } });
  }

  private reply(socket: WebSocket, response: Raw): void {
    const message: RawAppMessage = { response };
    socket.send(encodeMessage(message));
  }

  private handle(socket: WebSocket, data: Buffer): void {
    let request: Raw;
    try {
      request = decodeRequest(data);
    } catch {
      return;
    }
    this.requests.push(request);
    const seq = request.seq as number;
    const error = (code: string) => this.reply(socket, { seq, error: { error: code } });
    const ok = (body: Raw) => this.reply(socket, { seq, ...body });

    const player = this.options.player;
    if (player && (String(request.playerId) !== player.playerId || request.playerToken !== player.playerToken)) {
      return error('invalid_credentials');
    }

    const s = this.state;
    const entityId = request.entityId != null ? String(request.entityId) : '';
    const entity = s.entities.get(entityId);

    if (request.getInfo) return ok({ info: s.info });
    if (request.getTime) return ok({ time: s.time });
    if (request.getMap) return ok({ map: s.map });
    if (request.getTeamInfo) return ok({ teamInfo: s.teamInfo });
    if (request.getTeamChat) return ok({ teamChat: { messages: s.teamChat } });
    if (request.getMapMarkers) return ok({ mapMarkers: { markers: s.markers } });
    if (request.sendTeamMessage) {
      const me = (s.teamInfo.members as Raw[]).find((m) => String(m.steamId) === String(request.playerId));
      const entry = {
        steamId: String(request.playerId),
        name: me?.name ?? 'You',
        message: String(request.sendTeamMessage.message ?? ''),
        color: '#fff',
        time: Math.floor(Date.now() / 1000),
      };
      s.teamChat.push(entry);
      ok({ success: {} });
      return this.broadcast({ teamMessage: { message: entry } });
    }
    if (request.getEntityInfo) {
      if (!entity) return error('not_found');
      return ok({ entityInfo: { type: entity.type, payload: entity.payload } });
    }
    if (request.setEntityValue) {
      if (!entity) return error('not_found');
      if (entity.type !== EntityType.Switch) return error('wrong_type');
      entity.payload = { ...entity.payload, value: Boolean(request.setEntityValue.value) };
      ok({ success: {} });
      return this.broadcast({ entityChanged: { entityId, payload: entity.payload } });
    }
    if (request.checkSubscription) {
      if (!entity) return error('not_found');
      return ok({ flag: { value: s.subscriptions.has(entityId) } });
    }
    if (request.setSubscription) {
      if (!entity) return error('not_found');
      if (request.setSubscription.value) s.subscriptions.add(entityId);
      else s.subscriptions.delete(entityId);
      return ok({ success: {} });
    }
    if (request.promoteToLeader) {
      s.teamInfo.leaderSteamId = String(request.promoteToLeader.steamId);
      return ok({ success: {} });
    }
    return error('not_supported_by_fake_server');
  }
}
