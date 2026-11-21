import { describe, expect, it } from 'vitest';
import { RateLimiter, requestCost, TokenBucket, type Clock } from '../src/rate-limiter.ts';

function fakeClock(): Clock & { t: number; slept: number[] } {
  const clock = {
    t: 0,
    slept: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

describe('rate limiter', () => {
  it('refills over time up to capacity', () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(10, 2, clock);
    bucket.take(10);
    expect(bucket.available()).toBe(0);
    clock.t += 1000;
    expect(bucket.available()).toBe(2);
    clock.t += 60_000;
    expect(bucket.available()).toBe(10);
    expect(bucket.waitTime(4)).toBe(0);
    bucket.take(10);
    expect(bucket.waitTime(4)).toBe(2000);
  });

  it('waits once the player bucket is empty', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(
      { playerCapacity: 3, playerRefillPerSecond: 1, serverCapacity: 100, serverRefillPerSecond: 100 },
      clock,
    );
    await limiter.acquire(1);
    await limiter.acquire(1);
    await limiter.acquire(1);
    expect(clock.slept).toEqual([]);
    await limiter.acquire(1);
    expect(clock.slept).toEqual([1000]);
  });

  it('knows request costs', () => {
    expect(requestCost('getMap')).toBe(5);
    expect(requestCost('sendTeamMessage')).toBe(2);
    expect(requestCost('getInfo')).toBe(1);
  });
});
