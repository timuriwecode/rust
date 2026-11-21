import { describe, expect, it } from 'vitest';
import { redact } from '../src/recorder.ts';

describe('redact', () => {
  it('pseudonymises SteamIDs and player names consistently and drops secrets', () => {
    const input = {
      playerToken: 123,
      response: {
        teamInfo: {
          leaderSteamId: '76561198000000123',
          members: [{ steamId: '76561198000000123', name: 'RealName', x: 1, y: 2 }],
        },
        info: { name: 'Server Name' },
        map: { jpgImage: new Uint8Array(10) },
      },
    };
    const out = redact(input) as any;
    const leader = out.response.teamInfo.leaderSteamId;
    expect(leader).toMatch(/^7656119\d{10}$/);
    expect(leader).not.toBe('76561198000000123');
    expect(out.response.teamInfo.members[0].steamId).toBe(leader);
    expect(out.response.teamInfo.members[0].name).toMatch(/^player_[0-9a-f]{6}$/);
    expect(out.response.info.name).toBe('Server Name');
    expect(out.response.map.jpgImage).toBe('<10 bytes>');
    expect(out.playerToken).toBe('<redacted>');
    expect(out.response.teamInfo.members[0].x).toBe(1);
  });
});
