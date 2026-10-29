/**
 * Live Activities (docs/adr/0088; README: Live Activities). The relay keeps each host's latest
 * sealed slice per activity token, in memory only, and sends the merged ContentState to the
 * push service: routine updates at most once per `intervalMs` per token at priority 5, a new
 * Needs You at once with the alert. Slices are opaque; it reads only `active` and `alert`.
 */
import {
  type LivePushRequest,
  MAX_LIVE_HOSTS,
  type PushEnvironment,
  type RelayAddress,
  type WakeOutcome,
} from "@polaris/protocol/relay";

/** How often a routine update may go to one activity. */
export const LIVE_INTERVAL_MS = 5_000;

export interface LiveSlot {
  readonly peer: RelayAddress;
  readonly slice: string;
  readonly active: boolean;
}

interface Activity {
  readonly token: string;
  environment: PushEnvironment;
  readonly slots: Map<RelayAddress, LiveSlot>;
  /** When the last push went, in ms; 0 before any. */
  lastSent: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LivePut {
  readonly host: RelayAddress;
  readonly peer: RelayAddress;
  readonly token: string;
  readonly environment: PushEnvironment;
  /** Null: the host leaves this activity. */
  readonly slice: string | null;
  readonly active: boolean;
  readonly alert: boolean;
}

export interface LiveDeps {
  readonly deliver: (request: LivePushRequest) => Promise<WakeOutcome>;
  /** The activity is gone: tell `hosts` so they stop sending to it. */
  readonly gone: (
    hosts: ReadonlyArray<RelayAddress>,
    token: string,
    outcome: "unregistered"
  ) => void;
  readonly delivered: (outcome: WakeOutcome, hosts: number, alert: boolean) => void;
  /** Activities held at once, across hosts; a new one past it is ignored. */
  readonly maxActivities: number;
  /** Activities one host may hold slices in. */
  readonly maxPerHost: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
}

/** The slices one push carries, by host address; past six, those with work or Needs You win. */
export const mergeSlots = (slots: ReadonlyMap<RelayAddress, LiveSlot>): ReadonlyArray<string> => {
  const byAddress = [...slots].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  if (byAddress.length <= MAX_LIVE_HOSTS) return byAddress.map(([, slot]) => slot.slice);

  const kept = new Set(
    [
      ...byAddress.filter(([, slot]) => slot.active),
      ...byAddress.filter(([, slot]) => !slot.active),
    ]
      .slice(0, MAX_LIVE_HOSTS)
      .map(([host]) => host)
  );

  return byAddress.filter(([host]) => kept.has(host)).map(([, slot]) => slot.slice);
};

export class LiveActivities {
  private readonly activities = new Map<string, Activity>();
  private readonly tokensOf = new Map<RelayAddress, Set<string>>();
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: LiveDeps) {
    this.intervalMs = deps.intervalMs ?? LIVE_INTERVAL_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Stores a host's slice and sends, or schedules, the merged update. */
  put(put: LivePut): void {
    if (put.slice === null) return this.leave(put.host, put.token, put.peer);
    const activity = this.activityFor(put);

    if (activity === null) return;
    activity.environment = put.environment;
    activity.slots.set(put.host, { peer: put.peer, slice: put.slice, active: put.active });
    this.tokens(put.host).add(put.token);

    if (put.alert) this.send(activity, true);
    else this.schedule(activity);
  }

  /** Drops `host`'s slices in activities of devices it no longer lists. */
  unlisted(host: RelayAddress, listed: ReadonlySet<RelayAddress>): void {
    for (const token of Array.from(this.tokensOf.get(host) ?? [])) {
      const slot = this.activities.get(token)?.slots.get(host);

      if (slot !== undefined && !listed.has(slot.peer)) this.leave(host, token, slot.peer);
    }
  }

  get size(): number {
    return this.activities.size;
  }

  stop(): void {
    for (const activity of this.activities.values()) this.cancel(activity);
    this.activities.clear();
    this.tokensOf.clear();
  }

  private activityFor(put: LivePut): Activity | null {
    const existing = this.activities.get(put.token);

    if (existing !== undefined) {
      const known = existing.slots.has(put.host);

      return known || this.tokens(put.host).size < this.deps.maxPerHost ? existing : null;
    }

    if (
      this.activities.size >= this.deps.maxActivities ||
      this.tokens(put.host).size >= this.deps.maxPerHost
    )
      return null;

    const activity: Activity = {
      token: put.token,
      environment: put.environment,
      slots: new Map(),
      lastSent: 0,
      timer: null,
    };

    this.activities.set(put.token, activity);

    return activity;
  }

  private tokens(host: RelayAddress): Set<string> {
    const tokens = this.tokensOf.get(host) ?? new Set<string>();
    this.tokensOf.set(host, tokens);

    return tokens;
  }

  private leave(host: RelayAddress, token: string, peer: RelayAddress): void {
    const activity = this.activities.get(token);
    const slot = activity?.slots.get(host);

    if (activity === undefined || slot === undefined || slot.peer !== peer) return;
    activity.slots.delete(host);
    this.forgetToken(host, token);

    if (activity.slots.size === 0) this.remove(activity);
    else this.schedule(activity);
  }

  private forgetToken(host: RelayAddress, token: string): void {
    const tokens = this.tokensOf.get(host);
    tokens?.delete(token);

    if (tokens?.size === 0) this.tokensOf.delete(host);
  }

  private remove(activity: Activity): void {
    this.cancel(activity);
    this.activities.delete(activity.token);

    for (const host of activity.slots.keys()) this.forgetToken(host, activity.token);
  }

  private cancel(activity: Activity): void {
    if (activity.timer !== null) clearTimeout(activity.timer);
    activity.timer = null;
  }

  private schedule(activity: Activity): void {
    if (activity.timer !== null) return;
    const wait = activity.lastSent + this.intervalMs - this.now();

    if (wait <= 0) return this.send(activity, false);
    activity.timer = setTimeout(() => {
      activity.timer = null;

      if (this.activities.get(activity.token) === activity) this.send(activity, false);
    }, wait);
    activity.timer.unref?.();
  }

  private send(activity: Activity, alert: boolean): void {
    this.cancel(activity);
    activity.lastSent = this.now();
    const hosts = activity.slots.size;

    const request: LivePushRequest = {
      token: activity.token,
      environment: activity.environment,
      live: {
        event: "update",
        timestamp: Math.floor(activity.lastSent / 1000),
        state: { v: 1, slices: [...mergeSlots(activity.slots)] },
        alert,
      },
    };

    void this.deps.deliver(request).then((outcome) => {
      this.deps.delivered(outcome, hosts, alert);

      // APNs no longer knows the token: the activity ended, so every host stops sending to it.
      if (outcome !== "unregistered" || this.activities.get(activity.token) !== activity) return;
      // Hosts that joined while this push was out hear it too.
      const current = [...activity.slots.keys()];
      this.remove(activity);
      this.deps.gone(current, activity.token, "unregistered");
    });
  }
}
