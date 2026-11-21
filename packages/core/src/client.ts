import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { base64Url, COMPANION_HOST } from './auth.ts';
import { HandshakeError, NotConnectedError, RequestTimeoutError, RustPlusError } from './errors.ts';
import {
  toClanMessage,
  toEntityInfo,
  toEntityPayload,
  toGameTime,
  toMapData,
  toMapMarkers,
  toServerInfo,
  toTeamChat,
  toTeamInfo,
  toTeamMessage,
} from './normalize.ts';
import { decodeMessage, encodeRequest, type Raw, type RawAppMessage } from './protocol.ts';
import { RateLimiter, requestCost } from './rate-limiter.ts';
import type {
  ClanMessageBroadcast,
  EntityChangedBroadcast,
  EntityInfo,
  GameTime,
  MapData,
  MapMarker,
  ServerInfo,
  TeamChangedBroadcast,
  TeamInfo,
  TeamMessage,
} from './types.ts';

/**
 * Where to connect.
 *
 * - `relay`: the only way that works for game servers on the 5 Nov 2026 build
 *   and later. `serverId` is the `id` field of the in-game pairing
 *   notification, `authToken` is the Rust+ sign-in token. `host`/`secure`
 *   only need changing in tests.
 * - `direct`: the old `ws://ip:app.port` connection. Kept for local test
 *   servers and the fake server used in tests.
 */
export type Endpoint =
  | { kind: 'relay'; serverId: string; authToken: string; host?: string; secure?: boolean }
  | { kind: 'direct'; host: string; port: number; secure?: boolean };

export const RELAY_SUBPROTOCOL = 'rustplus.auth.v1';
/** Origin of Facepunch's own web client; the relay is used with this origin. */
export const RELAY_ORIGIN = 'https://app.playrust.com';

export interface ConnectionTarget {
  url: string;
  protocols: string[];
  headers: Record<string, string>;
}

export function connectionTarget(endpoint: Endpoint, nowMs = Date.now()): ConnectionTarget {
  if (endpoint.kind === 'relay') {
    const host = endpoint.host ?? COMPANION_HOST;
    return {
      url: `${endpoint.secure === false ? 'ws' : 'wss'}://${host}/socket/${encodeURIComponent(endpoint.serverId)}?v=${nowMs}`,
      protocols: [RELAY_SUBPROTOCOL, base64Url(endpoint.authToken)],
      headers: { Origin: RELAY_ORIGIN },
    };
  }
  const scheme = endpoint.secure ? 'wss' : 'ws';
  return { url: `${scheme}://${endpoint.host}:${endpoint.port}`, protocols: [], headers: {} };
}

export interface RustPlusClientOptions {
  endpoint: Endpoint;
  /** SteamID64 of the player, as a decimal string. */
  playerId: string;
  /** playerToken from the server pairing notification. */
  playerToken: number | string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Pass `null` to disable client-side rate limiting (tests only). */
  rateLimiter?: RateLimiter | null;
}

export interface RustPlusClientEvents {
  connected: [];
  disconnected: [code: number, reason: string];
  error: [error: Error];
  /** Every decoded message, before routing. Useful for recording. */
  message: [message: RawAppMessage];
  /** Every request sent: name and body. */
  request: [name: string, body: Raw];
  teamChanged: [event: TeamChangedBroadcast];
  teamMessage: [message: TeamMessage];
  entityChanged: [event: EntityChangedBroadcast];
  clanChanged: [clanInfo: Raw];
  clanMessage: [event: ClanMessageBroadcast];
  cameraRays: [rays: Raw];
}

interface Pending {
  name: string;
  resolve: (response: Raw) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RustPlusClient extends EventEmitter<RustPlusClientEvents> {
  private ws: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly limiter: RateLimiter | null;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly playerToken: number;

  constructor(private readonly options: RustPlusClientOptions) {
    super();
    this.limiter = options.rateLimiter === undefined ? new RateLimiter() : options.rateLimiter;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.playerToken = Number(options.playerToken);
    if (!Number.isInteger(this.playerToken)) {
      throw new Error(`playerToken must be an integer, got "${options.playerToken}"`);
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.ws) this.disconnect();
    const target = connectionTarget(this.options.endpoint);

    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const ws = new WebSocket(target.url, target.protocols, {
        headers: target.headers,
        handshakeTimeout: this.connectTimeoutMs,
      });
      this.ws = ws;
      const timer = setTimeout(() => {
        settle(new Error(`Connection timed out after ${this.connectTimeoutMs} ms`));
        ws.terminate();
      }, this.connectTimeoutMs);

      ws.on('unexpected-response', (req, res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (body.length < 2000) body += chunk;
        });
        res.on('end', () => {
          settle(new HandshakeError(res.statusCode ?? 0, body.trim()));
          req.destroy();
        });
      });

      ws.on('open', () => {
        opened = true;
        settle();
        this.emit('connected');
      });

      ws.on('error', (error) => {
        if (!settled) settle(error);
        else if (opened) this.emitError(error);
      });

      ws.on('close', (code, reasonBuffer) => {
        const reason = reasonBuffer.toString();
        if (this.ws === ws) this.ws = null;
        settle(new Error(`Connection closed before it opened (code ${code}${reason ? `: ${reason}` : ''})`));
        this.failPending(new NotConnectedError(`Connection closed (code ${code})`));
        if (opened) this.emit('disconnected', code, reason);
      });

      ws.on('message', (data, isBinary) => {
        // The relay can send text frames; only binary frames are AppMessages.
        if (!isBinary) return;
        this.handleFrame(toBytes(data));
      });
    });
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners('message');
      ws.terminate();
    }
    this.failPending(new NotConnectedError('Disconnected'));
  }

  /**
   * Sends one request. `name` is the AppRequest field (e.g. "getInfo"),
   * `payload` its message body. Resolves with the raw AppResponse.
   */
  async send(name: string, payload: Raw = {}, entityId?: string | number): Promise<Raw> {
    if (this.limiter) await this.limiter.acquire(requestCost(name));
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new NotConnectedError();

    const seq = ++this.seq;
    const body = { [name]: payload };
    const bytes = encodeRequest(
      { seq, playerId: this.options.playerId, playerToken: this.playerToken, ...(entityId != null ? { entityId } : {}) },
      body,
    );

    const response = new Promise<Raw>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new RequestTimeoutError(name, this.requestTimeoutMs));
      }, this.requestTimeoutMs);
      this.pending.set(seq, { name, resolve, reject, timer });
    });

    ws.send(bytes);
    this.emit('request', name, entityId != null ? { ...body, entityId: String(entityId) } : body);
    return response;
  }

  private handleFrame(bytes: Uint8Array): void {
    let message: RawAppMessage;
    try {
      message = decodeMessage(bytes);
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.emit('message', message);

    const response = message.response;
    if (response?.seq != null) {
      const pending = this.pending.get(response.seq);
      if (pending) {
        this.pending.delete(response.seq);
        clearTimeout(pending.timer);
        if (response.error) pending.reject(new RustPlusError(String(response.error.error ?? 'unknown'), pending.name));
        else pending.resolve(response);
      }
    }

    const b = message.broadcast;
    if (!b) return;
    if (b.teamChanged) {
      this.emit('teamChanged', {
        playerId: String(b.teamChanged.playerId ?? '0'),
        teamInfo: toTeamInfo(b.teamChanged.teamInfo),
      });
    }
    if (b.teamMessage) this.emit('teamMessage', toTeamMessage(b.teamMessage.message));
    if (b.entityChanged) {
      this.emit('entityChanged', {
        entityId: String(b.entityChanged.entityId ?? '0'),
        payload: toEntityPayload(b.entityChanged.payload),
      });
    }
    if (b.clanChanged) this.emit('clanChanged', b.clanChanged.clanInfo ?? {});
    if (b.clanMessage) {
      this.emit('clanMessage', {
        clanId: String(b.clanMessage.clanId ?? '0'),
        message: toClanMessage(b.clanMessage.message),
      });
    }
    if (b.cameraRays) this.emit('cameraRays', b.cameraRays);
  }

  /** 'error' without a listener would crash the process; drop it instead. */
  private emitError(error: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  private failPending(error: Error): void {
    for (const [seq, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(seq);
    }
  }

  // ---- Typed helpers -------------------------------------------------------

  async getInfo(): Promise<ServerInfo> {
    return toServerInfo((await this.send('getInfo')).info);
  }

  async getTime(): Promise<GameTime> {
    return toGameTime((await this.send('getTime')).time);
  }

  async getMap(): Promise<MapData> {
    return toMapData((await this.send('getMap')).map);
  }

  async getTeamInfo(): Promise<TeamInfo> {
    return toTeamInfo((await this.send('getTeamInfo')).teamInfo);
  }

  async getTeamChat(): Promise<TeamMessage[]> {
    return toTeamChat((await this.send('getTeamChat')).teamChat);
  }

  async sendTeamMessage(message: string): Promise<void> {
    await this.send('sendTeamMessage', { message });
  }

  /**
   * Since 6 Aug 2026 the server no longer sends vending machines, Cargo Ship,
   * patrol/attack helicopter or Travelling Vendor markers to Rust+.
   */
  async getMapMarkers(): Promise<MapMarker[]> {
    return toMapMarkers((await this.send('getMapMarkers')).mapMarkers);
  }

  async getEntityInfo(entityId: string | number): Promise<EntityInfo> {
    return toEntityInfo((await this.send('getEntityInfo', {}, entityId)).entityInfo);
  }

  async setEntityValue(entityId: string | number, value: boolean): Promise<void> {
    await this.send('setEntityValue', { value }, entityId);
  }

  async checkSubscription(entityId: string | number): Promise<boolean> {
    return Boolean((await this.send('checkSubscription', {}, entityId)).flag?.value);
  }

  async setSubscription(entityId: string | number, value: boolean): Promise<void> {
    await this.send('setSubscription', { value }, entityId);
  }

  async promoteToLeader(steamId: string): Promise<void> {
    await this.send('promoteToLeader', { steamId });
  }
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}
