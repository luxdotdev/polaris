import { strict as assert } from "node:assert";
import { expect, test } from "bun:test";
import { HostId, WorkspaceId, LanguageCheckout, LanguagePreviewPolicy } from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { PreviewDocument } from "./targets.ts";

const document: PreviewDocument = {
  hostKey: "fake-linux",
  hostId: HostId.make("host-fake"),
  checkout: LanguageCheckout.cases.Workspace.make({
    workspaceId: WorkspaceId.make("ws-fake"),
    path: "/fixture",
  }),
  path: "/fixture/docs/readme.md",
};

import { PreviewMediaPool } from "./media.ts";

const policy = LanguagePreviewPolicy.make({
  hostId: document.hostId,
  workspaceId: document.checkout.workspaceId,
  externalImages: "ask",
  html: "sanitized",
  scripts: "disabled",
  mermaid: "strict",
  maxMediaBytes: 10 * 1024 * 1024,
});

const media = { mimeType: "image/png", bytes: 3, base64: "AQID" };

test("eight concurrent tiny images progress through full response reservations", async () => {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  let next = 0;

  const api: LanguageApi = {
    request: async () => {
      calls++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;

      return { ok: true, value: media };
    },
    subscribe: () => () => {},
  };

  const pool = new PreviewMediaPool(api, document, policy, {
    create: () => `blob:${++next}`,
    revoke: () => {},
  });

  const images = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) => pool.acquire(`${index}.png`))
  );

  expect(images.filter((image) => image.status === "fulfilled")).toHaveLength(8);
  expect(calls).toBe(8);
  expect(peak).toBe(3);
  expect(peak * policy.maxMediaBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  pool.dispose();
});

const controlled = (
  options: { limit?: number; slots?: number; queued?: number; ms?: number } = {}
) => {
  const pending: Array<{ resolve: (value: typeof media) => void; reject: (error: Error) => void }> =
    [];

  const created: Array<string> = [];
  const revoked: Array<string> = [];
  let calls = 0;

  const api: LanguageApi = {
    request: async () => {
      calls++;

      return {
        ok: true,
        value: await new Promise<typeof media>((resolve, reject) =>
          pending.push({ resolve, reject })
        ),
      };
    },
    subscribe: () => () => {},
  };

  const pool = new PreviewMediaPool(
    api,
    document,
    { ...policy, maxMediaBytes: 10 },
    {
      create: () => {
        const url = `blob:${created.length}`;
        created.push(url);

        return url;
      },
      revoke: (url) => revoked.push(url),
    },
    options.limit ?? 10,
    options.slots ?? 16,
    options.queued ?? 16,
    options.ms ?? 15000
  );

  return { pool, pending, created, revoked, calls: () => calls };
};

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("queued cancellation removes a job before dispatch, freeing bounded queue space", async () => {
  const fixture = controlled({ limit: 20, slots: 2, queued: 1 });
  const first = fixture.pool.acquire("first.png");
  const second = fixture.pool.acquire("second.png");
  const controller = new AbortController();
  const canceled = fixture.pool.acquire("old-source.png", controller.signal);
  const canceledCheck = assert.rejects(canceled, /canceled/);
  await assert.rejects(fixture.pool.acquire("overflow.png"), /queue limit/);
  controller.abort();
  await canceledCheck;
  const replacement = fixture.pool.acquire("new-source.png");
  expect(fixture.calls()).toBe(2);
  fixture.pending[0]?.resolve(media);
  const lease = await first;
  lease.release();
  await tick();
  expect(fixture.calls()).toBe(3);
  fixture.pending[1]?.resolve(media);
  fixture.pending[2]?.resolve(media);
  (await second).release();
  (await replacement).release();
  expect(fixture.created).toHaveLength(3);
  fixture.pool.dispose();
});

test("disposal rejects queued/running work and late replies allocate or dispatch nothing", async () => {
  const fixture = controlled();
  const first = fixture.pool.acquire("first.png");
  const queued = fixture.pool.acquire("queued.png");
  const checks = [assert.rejects(first, /closed/), assert.rejects(queued, /closed/)];
  fixture.pool.dispose();
  await Promise.all(checks);
  fixture.pending[0]?.resolve(media);
  await tick();
  expect(fixture.calls()).toBe(1);
  expect(fixture.created).toHaveLength(0);
  await assert.rejects(fixture.pool.acquire("later.png"), /closed/);
});

test("failed request frees its reservation and admits the next eligible image", async () => {
  const fixture = controlled();
  const first = fixture.pool.acquire("bad.png");
  const failed = assert.rejects(first, /unavailable/);
  const second = fixture.pool.acquire("good.png");
  expect(fixture.calls()).toBe(1);
  fixture.pending[0]?.reject(new Error("fake failure"));
  await failed;
  await tick();
  expect(fixture.calls()).toBe(2);
  fixture.pending[1]?.resolve(media);
  (await second).release();
  fixture.pool.dispose();
});

test("running cancellation retains reservation until settlement and never creates its URL", async () => {
  const fixture = controlled();
  const controller = new AbortController();
  const first = fixture.pool.acquire("removed.png", controller.signal);
  const canceled = assert.rejects(first, /canceled/);
  const second = fixture.pool.acquire("replacement.png");
  controller.abort();
  await canceled;
  expect(fixture.calls()).toBe(1);
  fixture.pending[0]?.resolve(media);
  await tick();
  expect(fixture.calls()).toBe(2);
  expect(fixture.created).toHaveLength(0);
  fixture.pending[1]?.resolve(media);
  (await second).release();
  expect(fixture.created).toHaveLength(1);
  fixture.pool.dispose();
});

test("retained byte capacity and retained slots fail safely rather than wait forever", async () => {
  for (const options of [{ limit: 10 }, { limit: 30, slots: 1 }]) {
    const fixture = controlled(options);
    const first = fixture.pool.acquire("first.png");
    const blocked = fixture.pool.acquire("blocked.png");
    const check = assert.rejects(blocked, /retained capacity limit/);
    fixture.pending[0]?.resolve({ ...media, bytes: 10, base64: "AQIDAQIDAQIDAQ==" });
    const lease = await first;
    await check;
    expect(fixture.calls()).toBe(1);
    lease.release();
    const next = fixture.pool.acquire("after-release.png");
    expect(fixture.calls()).toBe(2);
    fixture.pending[1]?.resolve(media);
    (await next).release();
    fixture.pool.dispose();
  }
});

test("queued admission has a finite deadline even if the injected bridge never settles", async () => {
  const fixture = controlled({ ms: 10 });
  const first = fixture.pool.acquire("first.png");
  const firstCheck = assert.rejects(first, /closed/);
  await assert.rejects(fixture.pool.acquire("queued.png"), /deadline/);
  expect(fixture.calls()).toBe(1);
  fixture.pool.dispose();
  await firstCheck;
  fixture.pending[0]?.resolve(media);
  await tick();
  expect(fixture.created).toHaveLength(0);
});
