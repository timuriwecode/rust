import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Writes Rust+ traffic to a JSON Lines file, one entry per line:
 * `{"t":"2026-11-21T12:00:00.000Z","dir":"in","data":{...}}`.
 * Recordings become test fixtures, so `redact` replaces SteamIDs and player
 * names with stable pseudonyms before anything is written.
 */

export interface RecordEntry {
  t: string;
  dir: 'in' | 'out' | 'note';
  data: unknown;
}

const STEAM_ID_KEYS = new Set(['steamId', 'playerId', 'leaderSteamId', 'creator', 'motdAuthor', 'recruiter']);
const NAME_KEYS = new Set(['name']);
const DROP_KEYS = new Set(['playerToken', 'jpgImage', 'rayData', 'logo']);

function pseudonym(kind: string, value: string, salt: string): string {
  const hash = createHash('sha256').update(`${salt}:${kind}:${value}`).digest('hex');
  if (kind === 'name') return `player_${hash.slice(0, 6)}`;
  const digits = (BigInt(`0x${hash.slice(0, 15)}`) % 10_000_000_000n).toString().padStart(10, '0');
  return `7656119${digits}`;
}

/** Returns a deep copy with SteamIDs/names pseudonymised and secrets/blobs dropped. */
export function redact(value: unknown, salt = 'rcomp', parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, salt, parentKey));
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (DROP_KEYS.has(key)) {
        out[key] = v instanceof Uint8Array ? `<${v.byteLength} bytes>` : '<redacted>';
      } else if (STEAM_ID_KEYS.has(key) && (typeof v === 'string' || typeof v === 'number')) {
        out[key] = String(v) === '0' ? '0' : pseudonym('id', String(v), salt);
      } else if (NAME_KEYS.has(key) && typeof v === 'string' && parentKey !== 'info' && parentKey !== 'markers') {
        out[key] = v ? pseudonym('name', v, salt) : v;
      } else {
        out[key] = redact(v, salt, key);
      }
    }
    return out;
  }
  return value;
}

export class Recorder {
  private readonly stream: WriteStream;

  constructor(
    readonly path: string,
    private readonly options: { redact?: boolean; salt?: string } = {},
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: 'a' });
  }

  write(dir: RecordEntry['dir'], data: unknown): void {
    const payload = this.options.redact ? redact(data, this.options.salt) : stripBinary(data);
    const entry: RecordEntry = { t: new Date().toISOString(), dir, data: payload };
    this.stream.write(`${JSON.stringify(entry)}\n`);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

function stripBinary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBinary);
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'playerToken' ? '<redacted>' : stripBinary(v)]));
  }
  return value;
}
