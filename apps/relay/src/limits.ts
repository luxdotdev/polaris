/** Abuse limits: token buckets for rates and a per-address gate on connections. */

/** Refills `perSecond` tokens a second up to `burst`; `take` fails without spending when short. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number = performance.now.bind(performance)
  ) {
    this.tokens = burst;
    this.last = now();
  }

  take(count = 1): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;

    if (this.tokens < count) return false;
    this.tokens -= count;

    return true;
  }
}

export interface GateLimits {
  readonly maxConnections: number;
  readonly maxConnectionsPerIp: number;
  /** New connections a second from one address, with a burst of `connectBurstPerIp`. */
  readonly connectsPerSecondPerIp: number;
  readonly connectBurstPerIp: number;
}

export type GateRefusal = "relay-full" | "too-many-connections" | "connecting-too-fast";

interface IpState {
  open: number;
  readonly bucket: TokenBucket;
}

/**
 * Admits connections. Network addresses live here only while a connection is
 * open or its bucket is still refilling; they are never logged.
 */
export class ConnectionGate {
  private open = 0;
  private readonly ips = new Map<string, IpState>();

  constructor(
    private readonly limits: GateLimits,
    private readonly now: () => number = performance.now.bind(performance)
  ) {}

  admit(ip: string): GateRefusal | null {
    if (this.open >= this.limits.maxConnections) return "relay-full";

    const state = this.ips.get(ip) ?? {
      open: 0,
      bucket: new TokenBucket(
        this.limits.connectsPerSecondPerIp,
        this.limits.connectBurstPerIp,
        this.now
      ),
    };

    this.ips.set(ip, state);

    if (state.open >= this.limits.maxConnectionsPerIp) return "too-many-connections";

    if (!state.bucket.take()) return "connecting-too-fast";
    state.open++;
    this.open++;

    return null;
  }

  release(ip: string): void {
    const state = this.ips.get(ip);

    if (state === undefined) return;
    state.open--;
    this.open--;
  }

  /** Forgets addresses with nothing open, so the map does not grow with every visitor. */
  sweep(): void {
    for (const [ip, state] of this.ips) if (state.open === 0) this.ips.delete(ip);
  }

  get connections(): number {
    return this.open;
  }
}
