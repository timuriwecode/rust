/**
 * Client-side token buckets that mirror the limits the Rust server enforces,
 * so we wait instead of getting "rate_limit" errors.
 *
 * Defaults follow the values used by the maintained community clients
 * (rustplus.py 6.2): per player connection 25 tokens, +3/s; per server
 * 50 tokens, +15/s. Costs: getMap 5, sendTeamMessage/sendClanMessage 2,
 * everything else 1. Verify against a real server and adjust if needed.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly capacity: number,
    readonly refillPerSecond: number,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = capacity;
    this.last = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
  }

  available(): number {
    this.refill();
    return this.tokens;
  }

  /** Milliseconds until `cost` tokens are available (0 if available now). */
  waitTime(cost: number): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    return Math.ceil(((cost - this.tokens) / this.refillPerSecond) * 1000);
  }

  take(cost: number): void {
    this.refill();
    this.tokens -= cost;
  }
}

export interface RateLimits {
  playerCapacity: number;
  playerRefillPerSecond: number;
  serverCapacity: number;
  serverRefillPerSecond: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  playerCapacity: 25,
  playerRefillPerSecond: 3,
  serverCapacity: 50,
  serverRefillPerSecond: 15,
};

export const REQUEST_COSTS: Record<string, number> = {
  getMap: 5,
  sendTeamMessage: 2,
  sendClanMessage: 2,
};

export function requestCost(requestName: string): number {
  return REQUEST_COSTS[requestName] ?? 1;
}

export class RateLimiter {
  private readonly player: TokenBucket;
  private readonly server: TokenBucket;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    limits: RateLimits = DEFAULT_RATE_LIMITS,
    private readonly clock: Clock = realClock,
  ) {
    this.player = new TokenBucket(limits.playerCapacity, limits.playerRefillPerSecond, clock);
    this.server = new TokenBucket(limits.serverCapacity, limits.serverRefillPerSecond, clock);
  }

  /** Resolves once `cost` tokens are taken. Callers are served in FIFO order. */
  acquire(cost: number): Promise<void> {
    const run = async () => {
      for (;;) {
        const wait = Math.max(this.player.waitTime(cost), this.server.waitTime(cost));
        if (wait === 0) break;
        await this.clock.sleep(wait);
      }
      this.player.take(cost);
      this.server.take(cost);
    };
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
