import { expect, test } from "bun:test";
import { createDaemonRoutes, daemonAssetName } from "./index.ts";
import type { WideEvent } from "../../../../lib/log";
import type { AnalyticsValue, Track } from "../../../../lib/analytics";

type Tracked = { name: string; properties: Record<string, AnalyticsValue>; headers: object };

function setup(track?: Track) {
  const callbacks: (() => Promise<void>)[] = [];
  const events: WideEvent[] = [];
  const tracked: Tracked[] = [];

  const routes = createDaemonRoutes({
    log: {
      env: {},
      schedule: (callback) => {
        callbacks.push(callback);
      },
      emit: async (event) => {
        events.push(event);
      },
    },
    analytics: {
      schedule: (callback) => {
        callbacks.push(callback);
      },
      track:
        track ??
        (async (name, properties, options) => {
          tracked.push({ name, properties, headers: options.headers });
        }),
    },
  });

  const get = (version: string, platform: string, query = "", init: RequestInit = {}) =>
    routes.download(new Request(`https://polaris.lux.dev/api/daemon/x/y${query}`, init), {
      params: Promise.resolve({ version, platform }),
    });

  const flush = () => Promise.all(callbacks.map((callback) => callback()));

  return { get, flush, events, tracked, callbacks };
}

test("asset names match the release workflow's archives", () => {
  expect(daemonAssetName("0.1.0-alpha.3", "linux-arm64-musl")).toBe(
    "polaris-daemon-0.1.0-alpha.3-linux-arm64-musl.tar.gz"
  );
});

test.each([
  ["0.1.0-alpha.3", "linux-x64"],
  ["1.2.3", "darwin-arm64"],
  ["1.2.3-rc.1", "linux-arm64-musl"],
  ["0.2.0", "windows-x64"],
])(
  "%s %s redirects to the exact Release asset, prereleases included",
  async (version, platform) => {
    const { get, flush, events, tracked } = setup();
    const response = await get(version, platform, "?client=1.2.3&via=host");

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe(
      `https://github.com/luxdotdev/polaris/releases/download/v${version}/polaris-daemon-${version}-${platform}.tar.gz`
    );
    expect(await response.text()).toBe("");
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "daemon_download",
      route: "/api/daemon/[version]/[platform]",
      version,
      platform,
      client_version: "1.2.3",
      via: "host",
      status_code: 307,
    });
    expect(tracked).toEqual([
      {
        name: "daemon_download",
        properties: {
          version,
          platform,
          arch: platform.split("-")[1]!,
          client_version: "1.2.3",
          via: "host",
        },
        headers: { "user-agent": "" },
      },
    ]);
  }
);

test("the wide event splits the platform and drops unvalidated caller values", async () => {
  const { get, flush, events } = setup();

  await get("1.0.0", "linux-arm64-musl", "?client=203.0.113.10&via=elsewhere", {
    headers: { "x-forwarded-for": "203.0.113.10", "x-vercel-ip-country": "DE" },
  });
  await flush();
  expect(events[0]).toMatchObject({
    os: "linux",
    arch: "arm64",
    libc: "musl",
    client_version: null,
    via: null,
    country: "DE",
  });
  expect(JSON.stringify(events[0])).not.toContain("203.0.113.10");
});

test("analytics carries no IP, cookie or other header", async () => {
  const { get, flush, tracked } = setup();

  await get("1.0.0", "linux-x64", "", {
    headers: { "x-forwarded-for": "203.0.113.10", cookie: "a=b", "user-agent": "curl/8.5.0" },
  });
  await flush();
  expect(tracked[0]?.headers).toEqual({ "user-agent": "curl/8.5.0" });
});

test("a failing tracker never changes the response or the wide event", async () => {
  const { get, flush, events } = setup(async () => {
    throw new Error("analytics down");
  });

  const response = await get("1.0.0", "linux-x64");
  expect(response.status).toBe(307);
  await flush();
  expect(events[0]?.status_code).toBe(307);
});

test.each([
  ["not-a-version", "linux-x64", 400],
  ["1.0.0", "windows-arm64", 404],
  ["0.1.0-dev.812.abc1234", "linux-x64", 404],
  ["1.0.0+local", "linux-x64", 404],
])(
  "%s %s answers %d without a redirect or analytics, and logs",
  async (version, platform, status) => {
    const { get, flush, events, tracked } = setup();
    const response = await get(version, platform);

    expect(response.status).toBe(status);
    expect(response.headers.get("location")).toBeNull();
    await flush();
    expect(events[0]?.status_code).toBe(status);
    expect(tracked).toHaveLength(0);
  }
);
