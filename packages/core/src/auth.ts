/**
 * Rust+ auth token ("Rust+ sign-in"), needed to connect through the
 * Facepunch relay since the 5 Nov 2026 game update.
 *
 * Since October 2026 the Steam login on companion-rust.facepunch.com ends in a
 * redirect to `rust-plus://rust-auth-session/?token=<token>&steamId=<id>`.
 * The token looks like `base64(json).signature`, where the JSON payload holds
 * `steamId`, `version`, `iss` (issued, unix s) and `exp` (expires, unix s).
 * It lasts about 14 days.
 */

export const COMPANION_HOST = 'companion-rust.facepunch.com';

/** Login page whose final redirect carries the token. */
export const LOGIN_URL =
  `https://${COMPANION_HOST}/login?returnUrl=` +
  encodeURIComponent('/app?returnUrl=rust-plus://rust-auth-session');

export interface AuthTokenInfo {
  token: string;
  steamId: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
}

/**
 * Accepts a bare token, a URL-encoded token, or the whole
 * `rust-plus://rust-auth-session/?token=...&steamId=...` link.
 */
export function normaliseAuthToken(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  const match = /[?&]token=([^&#\s]+)/i.exec(value);
  if (match?.[1]) value = match[1];
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep as is */
    }
  }
  return value.length > 0 ? value : null;
}

function decodeBase64Json(segment: string): { json: string; value: Record<string, unknown> } | null {
  try {
    const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalised, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? { json, value: parsed as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

export function parseAuthToken(input: string): AuthTokenInfo | null {
  const token = normaliseAuthToken(input);
  if (!token) return null;
  const decoded = decodeBase64Json(token.split('.')[0] ?? '');
  if (!decoded) return null;
  const payload = decoded.value;
  const n = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  // A SteamID64 written as a JSON number does not fit in a double: read the digits from the text.
  const steamIdDigits = /"steamId"\s*:\s*"?(\d+)"?/.exec(decoded.json)?.[1];
  return {
    token,
    steamId: steamIdDigits ?? (payload.steamId != null ? String(payload.steamId) : null),
    issuedAt: n(payload.iss),
    expiresAt: n(payload.exp),
  };
}

export function isExpired(info: AuthTokenInfo, nowMs = Date.now()): boolean {
  return info.expiresAt != null && info.expiresAt * 1000 <= nowMs;
}

export function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
