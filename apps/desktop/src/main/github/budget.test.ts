import { describe, expect, test } from "bun:test";
import { allows, DEFAULT_POLICY, observe } from "./budget.ts";
import { type PollStep, pollStep } from "./deviceFlow.ts";
import type { TokenResponse } from "./wire.ts";

describe("the rate-limit budget", () => {
  const seen = { limit: 5000, remaining: 4000, resetAt: 10_000, cost: 1 };

  test("counts Polaris's own spending within a window, and starts again after it", () => {
    const first = observe(undefined, seen, 0);
    const second = observe(first, seen, 1);
    const next = observe(second, { ...seen, resetAt: 20_000 }, 11_000);

    expect([first.spent, second.spent, next.spent]).toEqual([1, 2, 1]);
  });

  test("stops at its share of the limit, or when little is left for anyone", () => {
    const window = { limit: 5000, remaining: 4000, resetAt: 10_000, spent: 1249 };

    expect(allows(window, DEFAULT_POLICY, 1, 0)).toBe(true);
    expect(allows({ ...window, spent: 1250 }, DEFAULT_POLICY, 1, 0)).toBe(false);
    expect(allows({ ...window, spent: 0, remaining: 400 }, DEFAULT_POLICY, 1, 0)).toBe(false);
    expect(allows({ ...window, spent: 5000 }, DEFAULT_POLICY, 1, 10_000)).toBe(true);
  });
});

describe("a device-flow poll", () => {
  test.each<[TokenResponse, PollStep]>([
    [{ error: "authorization_pending" }, { kind: "wait", interval: 5 }],
    [{ error: "slow_down" }, { kind: "wait", interval: 10 }],
    [
      { error: "slow_down", interval: 15 },
      { kind: "wait", interval: 15 },
    ],
    [{ error: "expired_token" }, { kind: "fail", failure: "expired" }],
    [{ error: "access_denied" }, { kind: "fail", failure: "denied" }],
    [{ error: "device_flow_disabled" }, { kind: "fail", failure: "disabled" }],
  ])("%o", (response, step) => {
    expect(pollStep(response, 5, 0)).toEqual(step);
  });

  test("a token, with its expiry and the granted scopes", () => {
    expect(
      pollStep(
        {
          access_token: "gho_x",
          refresh_token: "ghr_x",
          expires_in: 28_800,
          scope: "read:org,repo",
        },
        5,
        1000
      )
    ).toEqual({
      kind: "done",
      tokens: {
        accessToken: "gho_x",
        refreshToken: "ghr_x",
        expiresAt: 28_801_000,
        refreshExpiresAt: null,
      },
      scopes: ["read:org", "repo"],
    });
  });
});
