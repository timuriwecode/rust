import { describe, expect, it } from 'vitest';
import { ago, formatTeam, until } from '../src/format.ts';

const NOW = 1_800_000_000_000;

describe('format', () => {
  it('formats durations', () => {
    expect(ago(NOW / 1000 - 90, NOW)).toBe('1 мин назад');
    expect(ago(NOW / 1000 - 3 * 86400 - 7200, NOW)).toBe('3 д 2 ч назад');
    expect(until(NOW / 1000 + 10 * 86400 + 3 * 3600, NOW)).toBe('10 д 3 ч');
    expect(until(NOW / 1000 + 5400, NOW)).toBe('1 ч 30 мин');
    expect(until(NOW / 1000 - 1, NOW)).toBe('истекло');
  });

  it('formats team members with grid and status', () => {
    const text = formatTeam(
      {
        leaderSteamId: '1',
        members: [
          { steamId: '1', name: 'A', x: 0, y: 3500, isOnline: true, isAlive: true, spawnTime: 0, deathTime: 0 },
          { steamId: '2', name: 'B', x: 0, y: 3500, isOnline: false, isAlive: true, spawnTime: 0, deathTime: 0 },
        ],
        mapNotes: [],
        leaderMapNotes: [],
      },
      3500,
    );
    expect(text).toContain('● A [лидер] — A0, жив');
    expect(text).toContain('○ B — A0, оффлайн');
  });
});
