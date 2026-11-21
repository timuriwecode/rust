/**
 * Parsing of Rust+ push notifications (delivered through FCM).
 *
 * A notification carries `appData` key/value pairs: `title`, `message`,
 * `channelId` ("pairing", "alarm", ...) and `body`, a JSON string. For pairing
 * the body looks like:
 *
 *   {"id":"<server id>","ip":"1.2.3.4","port":"28082","name":"...","desc":"...",
 *    "img":"...","url":"...","type":"server","playerId":"7656...","playerToken":"-123"}
 *
 * plus `entityId`, `entityType`, `entityName` when `type` is "entity".
 * Since 5 Nov 2026 `id` is what the relay needs; `ip`/`port` may be missing.
 */

export interface PairedServer {
  /** Stable key: the relay server id when present, otherwise "ip:port". */
  key: string;
  relayId?: string;
  ip?: string;
  port?: number;
  name: string;
  description: string;
  img: string;
  url: string;
  playerId: string;
  playerToken: number;
}

export interface PairedEntity {
  entityId: string;
  entityType: number;
  entityName: string;
}

export type PushEvent =
  | { kind: 'serverPaired'; server: PairedServer; title: string; message: string }
  | { kind: 'entityPaired'; server: PairedServer; entity: PairedEntity; title: string; message: string }
  | { kind: 'alarm'; serverKey: string | null; title: string; message: string; body: Record<string, unknown> }
  | { kind: 'other'; channelId: string; title: string; message: string; body: Record<string, unknown> | null };

export interface RawPushMessage {
  persistentId?: string;
  appData?: Array<{ key: string; value: string }>;
}

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return v == null ? '' : String(v);
}

export function serverKeyOf(body: Record<string, unknown>): string | null {
  const id = field(body, 'id');
  if (id) return id;
  const ip = field(body, 'ip');
  const port = field(body, 'port');
  return ip && port ? `${ip}:${port}` : null;
}

function toServer(body: Record<string, unknown>): PairedServer | null {
  const key = serverKeyOf(body);
  const playerId = field(body, 'playerId');
  const playerToken = Number(field(body, 'playerToken'));
  if (!key || !playerId || !Number.isInteger(playerToken)) return null;
  const port = Number(field(body, 'port'));
  return {
    key,
    relayId: field(body, 'id') || undefined,
    ip: field(body, 'ip') || undefined,
    port: Number.isInteger(port) && port > 0 ? port : undefined,
    name: field(body, 'name'),
    description: field(body, 'desc').replace(/\\n/g, '\n').replace(/\\t/g, '\t'),
    img: field(body, 'img'),
    url: field(body, 'url'),
    playerId,
    playerToken,
  };
}

export function parsePushMessage(raw: RawPushMessage): PushEvent {
  const data = new Map((raw.appData ?? []).map((e) => [e.key, e.value]));
  const title = data.get('title') ?? '';
  const message = data.get('message') ?? '';
  const channelId = data.get('channelId') ?? '';
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(data.get('body') ?? 'null');
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (body && channelId === 'pairing') {
    const server = toServer(body);
    const type = field(body, 'type');
    if (server && type === 'server') return { kind: 'serverPaired', server, title, message };
    if (server && type === 'entity' && field(body, 'entityId')) {
      return {
        kind: 'entityPaired',
        server,
        entity: {
          entityId: field(body, 'entityId'),
          entityType: Number(field(body, 'entityType')) || 0,
          entityName: field(body, 'entityName'),
        },
        title,
        message,
      };
    }
  }
  if (body && channelId === 'alarm') {
    return { kind: 'alarm', serverKey: serverKeyOf(body), title, message, body };
  }
  return { kind: 'other', channelId, title, message, body };
}
