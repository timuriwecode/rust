import { describe, expect, it } from 'vitest';
import { base64Url, isExpired, LOGIN_URL, normaliseAuthToken, parseAuthToken } from '../src/auth.ts';

// steamId as a bare JSON number: more digits than a double can hold exactly.
const payloadJson = '{"steamId":76561198000000123,"version":1,"iss":1790000000,"exp":1791209600}';
const token = `${Buffer.from(payloadJson).toString('base64')}.c2lnbmF0dXJl`;

describe('auth token', () => {
  it('parses steamId and expiry from the token payload', () => {
    expect(parseAuthToken(token)).toEqual({
      token,
      steamId: '76561198000000123',
      issuedAt: 1_790_000_000,
      expiresAt: 1_791_209_600,
    });
  });

  it('accepts the full rust-plus:// redirect link and URL-encoded tokens', () => {
    const link = `rust-plus://rust-auth-session/?token=${encodeURIComponent(token)}&steamId=76561198000000123`;
    expect(normaliseAuthToken(link)).toBe(token);
    expect(normaliseAuthToken(encodeURIComponent(token))).toBe(token);
    expect(normaliseAuthToken('   ')).toBeNull();
  });

  it('reads a steamId given as a JSON string too', () => {
    const t = `${Buffer.from('{"steamId":"76561198000000999","exp":1}').toString('base64url')}.sig`;
    expect(parseAuthToken(t)?.steamId).toBe('76561198000000999');
  });

  it('rejects garbage', () => {
    expect(parseAuthToken('not-a-token')).toBeNull();
  });

  it('detects expiry', () => {
    const info = parseAuthToken(token)!;
    expect(isExpired(info, 1_791_209_599_000)).toBe(false);
    expect(isExpired(info, 1_791_209_600_000)).toBe(true);
  });

  it('base64url-encodes without padding', () => {
    expect(base64Url('a?b>')).toBe('YT9iPg');
  });

  it('builds the login URL with the app return chain', () => {
    expect(decodeURIComponent(LOGIN_URL)).toContain('/app?returnUrl=rust-plus://rust-auth-session');
  });
});
