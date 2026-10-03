import { expect, test } from "bun:test";
import { fixture, zip, dmg } from "./fixtures.ts";
import { createReleaseRoutes } from "./index.ts";
import { publishedRelease, type PublishedRelease } from "./releases.ts";
import type { WideEvent } from "../../../../lib/log";

function setup(
  latest: () => Promise<PublishedRelease | null> = async () => publishedRelease(fixture)
) {
  const callbacks: (() => Promise<void>)[] = [];
  const events: WideEvent[] = [];

  const routes = createReleaseRoutes({
    latest,
    log: {
      env: {},
      schedule: (callback) => {
        callbacks.push(callback);
      },
      emit: async (event) => {
        events.push(event);
      },
    },
  });

  return { routes, callbacks, events };
}

test.each(["1.2.3", "1.2.3+local", "1.2.4", "2.0.0"])(
  "204 without body for same or newer %s, logs each request",
  async (version) => {
    const { routes, callbacks, events } = setup();

    for (let count = 0; count < 2; count++) {
      const response = await routes.update(
        new Request("https://polaris.lux.dev/ignored?secret=value"),
        { params: Promise.resolve({ version }) }
      );

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    expect(callbacks).toHaveLength(2);
    expect(events).toHaveLength(0);
    await Promise.all(callbacks.map((callback) => callback()));
    expect(events).toHaveLength(2);
    expect(events[0]?.version).toBe(version);
    expect(events[0]?.status_code).toBe(204);
  }
);

test.each(["1.2.2", "1.2.3-rc.1", "1.1.99", "0.9.9"])(
  "Squirrel JSON for older %s",
  async (version) => {
    const { routes, callbacks, events } = setup();

    const response = await routes.update(new Request("https://polaris.lux.dev/"), {
      params: Promise.resolve({ version }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      url: zip,
      name: fixture.name,
      notes: fixture.body,
      pub_date: fixture.published_at,
    });
    expect(callbacks).toHaveLength(1);
    await callbacks[0]!();
    expect(events[0]?.status_code).toBe(200);
  }
);

test("malformed versions return 400 without lookup and without logging raw input", async () => {
  const { routes, callbacks, events } = setup(async () => {
    throw new Error("Lookup must not run");
  });

  const response = await routes.update(new Request("https://polaris.lux.dev/"), {
    params: Promise.resolve({ version: "203.0.113.10" }),
  });

  expect(response.status).toBe(400);
  expect(callbacks).toHaveLength(1);
  await callbacks[0]!();
  expect(events[0]?.version).toBeNull();
});

test("download redirects temporarily to the latest DMG and logs once", async () => {
  const { routes, callbacks, events } = setup();

  const response = await routes.download(
    new Request("https://polaris.lux.dev/download/mac"),
    undefined
  );

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(dmg);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(callbacks).toHaveLength(1);
  await callbacks[0]!();
  expect(events[0]).toMatchObject({
    event: "download",
    route: "/download/mac",
    version: null,
    status_code: 307,
  });
});

test("no published Release means no update, and download unavailable; both log", async () => {
  const { routes, callbacks, events } = setup(async () => null);
  expect(
    (
      await routes.update(new Request("https://polaris.lux.dev/"), {
        params: Promise.resolve({ version: "1.0.0" }),
      })
    ).status
  ).toBe(204);
  expect((await routes.download(new Request("https://polaris.lux.dev/"), undefined)).status).toBe(
    503
  );
  await Promise.all(callbacks.map((callback) => callback()));
  expect(events.map((event) => event.status_code)).toEqual([204, 503]);
});

test("upstream failures or missing assets return retryable 503 and still log once", async () => {
  for (const latest of [
    async () => {
      throw new Error("private upstream details");
    },
    async () => publishedRelease({ ...fixture, assets: [] }),
  ]) {
    const { routes, callbacks, events } = setup(latest);

    const update = await routes.update(new Request("https://polaris.lux.dev/"), {
      params: Promise.resolve({ version: "1.0.0" }),
    });

    const download = await routes.download(new Request("https://polaris.lux.dev/"), undefined);

    for (const response of [update, download]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.text()).not.toContain("private");
    }

    expect(callbacks).toHaveLength(2);
    await Promise.all(callbacks.map((callback) => callback()));
    expect(events).toHaveLength(2);
  }
});
