/**
 * Polaris's share of each account's hourly rate limits. The limits are per user and
 * shared with `gh`, editors and the rest, so background polling stops at a share.
 */

/** GitHub's buckets: REST (`core`) and GraphQL points are counted separately. */
export type Resource = "core" | "graphql";

export interface RateWindow {
  readonly limit: number;
  readonly remaining: number;
  /** Epoch ms when the window resets. */
  readonly resetAt: number;
  /** What Polaris itself spent in this window. */
  readonly spent: number;
}

export interface BudgetPolicy {
  /** The most of `limit` background polling may spend in one window. */
  readonly share: number;
  /** Polling stops when fewer than this share of `limit` remain, whoever spent it. */
  readonly reserve: number;
}

export const DEFAULT_POLICY: BudgetPolicy = { share: 0.25, reserve: 0.1 };

/** What one response said about the limit, from its `x-ratelimit-*` headers. */
export interface RateObservation {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
  /** What this request cost: 0 for a 304, 1 for a REST call or a small GraphQL query. */
  readonly cost: number;
}

export const observe = (
  previous: RateWindow | undefined,
  seen: RateObservation,
  now: number
): RateWindow => {
  const sameWindow =
    previous !== undefined && previous.resetAt > now && previous.resetAt === seen.resetAt;

  return {
    limit: seen.limit,
    remaining: seen.remaining,
    resetAt: seen.resetAt,
    spent: (sameWindow ? previous.spent : 0) + seen.cost,
  };
};

/** Whether background work may spend `cost` more; user actions skip the share. */
export const allows = (
  window: RateWindow | undefined,
  policy: BudgetPolicy,
  cost: number,
  now: number
) => {
  if (window === undefined || window.resetAt <= now) return true;

  const withinShare = window.spent + cost <= policy.share * window.limit;
  const aboveReserve = window.remaining - cost >= policy.reserve * window.limit;

  return withinShare && aboveReserve;
};

/** Every account's windows; one per process, shared by the poller and the review calls. */
export interface Budget {
  readonly record: (accountId: number, resource: Resource, seen: RateObservation) => void;
  readonly allows: (accountId: number, resource: Resource, cost: number) => boolean;
  /** When the blocking window resets; null when nothing blocks. */
  readonly blockedUntil: (accountId: number, resource: Resource) => number | null;
  readonly window: (accountId: number, resource: Resource) => RateWindow | undefined;
}

export const newBudget = (now: () => number, policy: BudgetPolicy = DEFAULT_POLICY): Budget => {
  const windows = new Map<string, RateWindow>();
  const key = (accountId: number, resource: Resource) => `${accountId}:${resource}`;

  return {
    record: (accountId, resource, seen) => {
      const k = key(accountId, resource);

      windows.set(k, observe(windows.get(k), seen, now()));
    },
    allows: (accountId, resource, cost) =>
      allows(windows.get(key(accountId, resource)), policy, cost, now()),
    blockedUntil: (accountId, resource) => {
      const window = windows.get(key(accountId, resource));

      return window !== undefined && !allows(window, policy, 1, now()) ? window.resetAt : null;
    },
    window: (accountId, resource) => windows.get(key(accountId, resource)),
  };
};
