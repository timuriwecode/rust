import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { parseAuthToken, type AuthTokenInfo } from '@rcomp/core';
import type { PairedEntity, PairedServer, PushEvent } from './notification.ts';

/**
 * Local storage for secrets and paired servers. Lives in the user's config
 * directory (never in the repository) and is written with mode 0600.
 */

export interface StoredServer extends PairedServer {
  pairedAt: string;
  entities: Record<string, PairedEntity & { pairedAt: string }>;
}

export interface FcmCredentials {
  androidId: string;
  securityToken: string;
  fcmToken: string;
  expoPushToken?: string;
  registeredAt?: string;
}

export interface StoredConfig {
  version: 1;
  auth?: { token: string; steamId: string | null; expiresAt: number | null };
  fcm?: FcmCredentials;
  /** Ids of push messages already received, so FCM does not redeliver them. */
  persistentIds: string[];
  servers: Record<string, StoredServer>;
  activeServer?: string;
}

const MAX_PERSISTENT_IDS = 200;

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RCOMP_HOME) return env.RCOMP_HOME;
  const os = platform();
  if (os === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'rust-companion');
  if (os === 'darwin') return join(homedir(), 'Library', 'Application Support', 'rust-companion');
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'rust-companion');
}

function emptyConfig(): StoredConfig {
  return { version: 1, persistentIds: [], servers: {} };
}

export class ConfigStore {
  config: StoredConfig;

  constructor(readonly path: string = join(defaultConfigDir(), 'config.json')) {
    this.config = existsSync(path) ? { ...emptyConfig(), ...JSON.parse(readFileSync(path, 'utf8')) } : emptyConfig();
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* not supported on every filesystem */
    }
  }

  setAuthToken(input: string): AuthTokenInfo {
    const info = parseAuthToken(input);
    if (!info) throw new Error('This does not look like a Rust+ auth token');
    this.config.auth = { token: info.token, steamId: info.steamId, expiresAt: info.expiresAt };
    return info;
  }

  rememberPersistentId(id: string | undefined): void {
    if (!id || this.config.persistentIds.includes(id)) return;
    this.config.persistentIds.push(id);
    if (this.config.persistentIds.length > MAX_PERSISTENT_IDS) {
      this.config.persistentIds.splice(0, this.config.persistentIds.length - MAX_PERSISTENT_IDS);
    }
  }

  /** Stores what a push event tells us. Returns true when the config changed. */
  apply(event: PushEvent, now = new Date()): boolean {
    if (event.kind === 'serverPaired') {
      const existing = this.findServer(event.server);
      const entities = existing?.entities ?? {};
      if (existing && existing.key !== event.server.key) delete this.config.servers[existing.key];
      this.config.servers[event.server.key] = { ...event.server, pairedAt: now.toISOString(), entities };
      this.config.activeServer ??= event.server.key;
      return true;
    }
    if (event.kind === 'entityPaired') {
      let server = this.findServer(event.server);
      if (!server) {
        server = { ...event.server, pairedAt: now.toISOString(), entities: {} };
        this.config.servers[server.key] = server;
      }
      server.entities[event.entity.entityId] = { ...event.entity, pairedAt: now.toISOString() };
      return true;
    }
    return false;
  }

  /** Same server, possibly paired before the relay id existed (keyed by ip:port then). */
  findServer(server: Pick<PairedServer, 'key' | 'relayId' | 'ip' | 'port'>): StoredServer | undefined {
    const byKey = this.config.servers[server.key];
    if (byKey) return byKey;
    return Object.values(this.config.servers).find(
      (s) =>
        (server.relayId && s.relayId === server.relayId) ||
        (server.ip && server.port && s.ip === server.ip && s.port === server.port),
    );
  }

  /** Finds a server by key, relay id or a case-insensitive part of its name. */
  resolveServer(query?: string): StoredServer | undefined {
    const servers = this.config.servers;
    if (!query) return servers[this.config.activeServer ?? ''] ?? Object.values(servers)[0];
    if (servers[query]) return servers[query];
    const q = query.toLowerCase();
    return Object.values(servers).find((s) => s.relayId === query || s.name.toLowerCase().includes(q));
  }

  /**
   * Imports a `rustplus.config.json` written by `npx @liamcottle/rustplus.js fcm-register`.
   */
  importRustplusJsConfig(json: Record<string, unknown>): void {
    const fcm = json.fcm_credentials as { gcm?: { androidId?: string; securityToken?: string }; fcm?: { token?: string } } | undefined;
    if (fcm?.gcm?.androidId && fcm.gcm.securityToken) {
      this.config.fcm = {
        androidId: String(fcm.gcm.androidId),
        securityToken: String(fcm.gcm.securityToken),
        fcmToken: String(fcm.fcm?.token ?? ''),
        expoPushToken: typeof json.expo_push_token === 'string' ? json.expo_push_token : undefined,
      };
    }
    if (typeof json.rustplus_auth_token === 'string' && parseAuthToken(json.rustplus_auth_token)) {
      this.setAuthToken(json.rustplus_auth_token);
    }
  }
}
