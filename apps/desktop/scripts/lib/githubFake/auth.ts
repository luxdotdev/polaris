/**
 * The fake's OAuth: the device flow (codes approved or denied by a test, polling
 * too fast answers `slow_down`), expiring tokens that rotate on refresh, and each
 * user's rate-limit windows.
 */
import { Schema } from "effect";
import { type FakeRequest, type FakeResponse, json } from "./http.ts";
import type { FakeUser, World } from "./world.ts";

export const ACCESS_TTL_S = 8 * 60 * 60;

export const REFRESH_TTL_S = 15_897_600;

interface DeviceEntry {
  readonly userCode: string;
  readonly expiresAt: number;
  interval: number;
  lastPollAt: number | null;
  approvedBy: string | null;
  denied: boolean;
  consumed: boolean;
}

interface Grant {
  readonly login: string;
  readonly expiresAt: number;
}

export interface RateWindow {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface AuthOptions {
  readonly now: () => number;
  /** Seconds between polls the fake asks for; GitHub says 5. */
  readonly interval: number;
  /** Whether polling faster than the interval answers `slow_down`. */
  readonly enforceInterval: boolean;
  readonly clientId: string;
  /** Where users enter the code: `<web>/login/device`. */
  readonly webUrl: string;
}

const Form = Schema.Record(Schema.String, Schema.String);

const formOf = (body: string) =>
  Schema.decodeUnknownSync(Form)(Object.fromEntries(new URLSearchParams(body)));

export const newAuth = (world: World, options: AuthOptions) => {
  const devices = new Map<string, DeviceEntry>();
  const tokens = new Map<string, Grant>();
  const refreshTokens = new Map<string, Grant>();
  const rates = new Map<string, RateWindow>();
  let serial = 0;

  const issue = (login: string) => {
    serial += 1;
    const now = options.now();
    const access = `gho_fake${serial}_${login}`;
    const refresh = `ghr_fake${serial}_${login}`;

    tokens.set(access, { login, expiresAt: now + ACCESS_TTL_S * 1000 });
    refreshTokens.set(refresh, { login, expiresAt: now + REFRESH_TTL_S * 1000 });

    return {
      access_token: access,
      token_type: "bearer",
      scope: "read:org,repo",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      refresh_token_expires_in: REFRESH_TTL_S,
    };
  };

  const deviceCode = (form: Readonly<Record<string, string>>): FakeResponse => {
    if (form["client_id"] !== options.clientId)
      return json(200, { error: "incorrect_client_credentials" });

    serial += 1;
    const code = `dc_fake_${serial}`;
    const userCode = `ABCD-${String(1000 + serial).slice(-4)}`;

    devices.set(code, {
      userCode,
      expiresAt: options.now() + 900_000,
      interval: options.interval,
      lastPollAt: null,
      approvedBy: null,
      denied: false,
      consumed: false,
    });

    return json(200, {
      device_code: code,
      user_code: userCode,
      verification_uri: `${options.webUrl}/login/device`,
      expires_in: 900,
      interval: options.interval,
    });
  };

  const pollDevice = (entry: DeviceEntry) => {
    const now = options.now();
    const early = entry.lastPollAt !== null && now - entry.lastPollAt < entry.interval * 1000;

    entry.lastPollAt = now;

    if (entry.consumed || now >= entry.expiresAt) return json(200, { error: "expired_token" });

    if (entry.denied) return json(200, { error: "access_denied" });

    if (options.enforceInterval && early) {
      entry.interval += 5;

      return json(200, { error: "slow_down", interval: entry.interval });
    }

    if (entry.approvedBy === null) return json(200, { error: "authorization_pending" });
    entry.consumed = true;

    return json(200, issue(entry.approvedBy));
  };

  const refresh = (token: string) => {
    const grant = refreshTokens.get(token);

    refreshTokens.delete(token);

    if (grant === undefined || grant.expiresAt <= options.now()) {
      return json(200, {
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      });
    }

    // Rotation voids the old access tokens too.
    for (const [access, g] of tokens) if (g.login === grant.login) tokens.delete(access);

    return json(200, issue(grant.login));
  };

  const accessToken = (form: Readonly<Record<string, string>>): FakeResponse => {
    if (form["client_id"] !== options.clientId)
      return json(200, { error: "incorrect_client_credentials" });

    if (form["grant_type"] === "refresh_token") return refresh(form["refresh_token"] ?? "");

    const entry = devices.get(form["device_code"] ?? "");

    return entry === undefined ? json(200, { error: "incorrect_device_code" }) : pollDevice(entry);
  };

  /** `/login/device/code` and `/login/oauth/access_token`; null for any other path. */
  const oauth = (request: FakeRequest): FakeResponse | null => {
    if (request.method !== "POST") return null;

    if (request.path === "/login/device/code") return deviceCode(formOf(request.body));

    if (request.path === "/login/oauth/access_token") return accessToken(formOf(request.body));

    return null;
  };

  /** The user behind `Authorization: Bearer …`, or null (a 401). */
  const userOf = (request: FakeRequest): FakeUser | null => {
    const header = request.headers.get("authorization") ?? "";
    const grant = tokens.get(header.replace(/^Bearer\s+/i, ""));

    if (grant === undefined || grant.expiresAt <= options.now()) return null;

    return world.users.find((u) => u.login === grant.login) ?? null;
  };

  const windowOf = (login: string, resource: string) => {
    const key = `${login}:${resource}`;
    const now = options.now();
    let window = rates.get(key);

    if (window === undefined || window.resetAt <= now) {
      window = { limit: 5000, remaining: 5000, resetAt: now + 3_600_000 };
      rates.set(key, window);
    }

    return window;
  };

  /** Spends `cost` and returns the `x-ratelimit-*` headers; null when the window is spent. */
  const spend = (login: string, resource: "core" | "graphql", cost: number) => {
    const window = windowOf(login, resource);
    const exhausted = window.remaining - cost < 0;

    if (!exhausted) window.remaining -= cost;

    return {
      exhausted,
      headers: {
        "x-ratelimit-limit": String(window.limit),
        "x-ratelimit-remaining": String(window.remaining),
        "x-ratelimit-used": String(window.limit - window.remaining),
        "x-ratelimit-reset": String(Math.ceil(window.resetAt / 1000)),
        "x-ratelimit-resource": resource,
      },
    };
  };

  return {
    oauth,
    userOf,
    spend,
    windowOf,
    approve: (userCode: string, login: string) => {
      for (const entry of devices.values())
        if (entry.userCode === userCode) entry.approvedBy = login;
    },
    deny: (userCode: string) => {
      for (const entry of devices.values()) if (entry.userCode === userCode) entry.denied = true;
    },
    /** Every access token expires now: the next call gets a 401 and must refresh. */
    expireAccessTokens: () => {
      for (const [access, grant] of tokens) tokens.set(access, { ...grant, expiresAt: 0 });
    },
    revokeAll: (login: string) => {
      for (const [k, g] of tokens) if (g.login === login) tokens.delete(k);

      for (const [k, g] of refreshTokens) if (g.login === login) refreshTokens.delete(k);
    },
    pendingCodes: () => [...devices.values()].flatMap((d) => (d.consumed ? [] : [d.userCode])),
  };
};

export type FakeAuth = ReturnType<typeof newAuth>;
