import { expect, test } from "bun:test";
import type { HostImage } from "./index.ts";
import { HostImagePool, type HostImageLimits } from "./pool.ts";

const LIMITS: HostImageLimits = {
  images: 2,
  bytes: 100,
  decodedBytes: 1000,
  reads: 2,
  retryMs: 5000,
};

const ready = (bytes = 10, decodedBytes = 100): HostImage => ({
  kind: "ready",
  blob: new Blob(["x"]),
  bytes,
  decodedBytes,
});

/** A pool over a fake Host whose answers the test picks per path, counting reads and URLs. */
const poolWith = (answer: (path: string) => HostImage, limits = LIMITS) => {
  const reads: string[] = [];
  const live = new Set<string>();
  let made = 0;
  let clock = 0;

  const pool = new HostImagePool(
    {
      read: (_hostKey, path) => {
        reads.push(path);

        return Promise.resolve(answer(path));
      },
      createUrl: () => {
        made += 1;
        const url = `blob:${made}`;
        live.add(url);

        return url;
      },
      revokeUrl: (url) => live.delete(url),
      now: () => clock,
    },
    limits
  );

  return {
    pool,
    reads,
    live,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

test("an unused image is kept until room is needed, then its URL is revoked", async () => {
  const { pool, reads, live } = poolWith(() => ready());

  for (const path of ["/a.png", "/b.png", "/c.png"]) {
    const lease = pool.acquire("h", path);

    await lease.settled;
    lease.release();
  }

  expect(live.size).toBe(2);
  const again = pool.acquire("h", "/c.png");

  expect(again.current?.kind).toBe("ready");
  await pool.acquire("h", "/a.png").settled;
  expect(reads).toEqual(["/a.png", "/b.png", "/c.png", "/a.png"]);
});

test("images in view past the bound show as too many, not by evicting what's shown", async () => {
  const { pool, live } = poolWith(() => ready(60));

  const first = await pool.acquire("h", "/a.png").settled;
  const second = await pool.acquire("h", "/b.png").settled;

  expect(first.kind).toBe("ready");
  expect(second).toEqual({ kind: "failed", reason: "busy" });
  expect(live.size).toBe(1);
});

test("a failure is asked again once its retry has passed, so a Host back online shows it", async () => {
  let online = false;

  const { pool, reads, advance } = poolWith(() =>
    online ? ready() : { kind: "failed", reason: "offline" }
  );

  const lease = pool.acquire("h", "/a.png");

  expect(await lease.settled).toEqual({ kind: "failed", reason: "offline" });
  lease.release();
  const soon = pool.acquire("h", "/a.png");

  expect(soon.current).toEqual({ kind: "failed", reason: "offline" });
  soon.release();

  online = true;
  advance(LIMITS.retryMs);
  expect((await pool.acquire("h", "/a.png").settled).kind).toBe("ready");
  expect(reads).toEqual(["/a.png", "/a.png"]);
});

test("an image released before its read starts is never read", async () => {
  const { pool, reads } = poolWith(() => ready(), { ...LIMITS, reads: 1 });

  const first = pool.acquire("h", "/a.png");
  const skipped = pool.acquire("h", "/b.png");

  skipped.release();
  await first.settled;
  await skipped.settled;

  expect(reads).toEqual(["/a.png"]);
});
