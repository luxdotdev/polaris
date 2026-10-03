import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { RendererLanguageIdentityCache, type RendererLanguageConnection } from "./identity.ts";
import type { AuthenticatedLanguageIdentity } from "./lifecycle.ts";

const identity = (connectionEpoch = 1): AuthenticatedLanguageIdentity => ({
  hostId: P.HostId.make("fake"),
  clientId: "main-bound-client",
  connectionEpoch,
});

const fixture = (timeoutMs = 5000) => {
  const abort = new AbortController();

  let connection: RendererLanguageConnection | null = {
    token: {},
    hostId: P.HostId.make("fake"),
    signal: abort.signal,
    languages: true,
  };

  const pending: Array<{
    readonly signal: AbortSignal;
    readonly resolve: (value: AuthenticatedLanguageIdentity | null) => void;
  }> = [];

  let changes = 0;

  const cache = new RendererLanguageIdentityCache(
    {
      connection: () => connection,
      fetch: (_hostKey, signal) =>
        new Promise((resolve) => {
          pending.push({ signal, resolve });
        }),
      changed: () => {
        changes++;
      },
    },
    timeoutMs
  );

  return {
    cache,
    pending,
    abort,
    connection: (next: RendererLanguageConnection | null) => {
      connection = next;
    },
    replace: () => {
      connection = {
        token: {},
        hostId: P.HostId.make("fake"),
        signal: new AbortController().signal,
        languages: true,
      };
    },
    changes: () => changes,
  };
};

test("Main identity remains unavailable until current typed lookup settles, then is immutable and deduplicated", async () => {
  const f = fixture();
  const first = f.cache.refresh("fake");
  expect(f.cache.lookup("fake")).toBeNull();
  expect(f.cache.refresh("fake")).toBe(first);
  await Promise.resolve();
  f.pending[0]?.resolve(identity());
  expect(await first).toEqual(identity());
  expect(Object.isFrozen(f.cache.lookup("fake"))).toBe(true);
  expect(f.pending).toHaveLength(1);
  f.cache.dispose();
  expect(f.cache.lookup("fake")).toBeNull();
});

test("replacement rejects late lookup and abort invalidates before a response can revive it", async () => {
  const f = fixture();
  const first = f.cache.refresh("fake");
  await Promise.resolve();
  f.replace();
  expect(f.cache.lookup("fake")).toBeNull();
  expect(f.pending[0]?.signal.aborted).toBe(true);
  const second = f.cache.refresh("fake");
  await Promise.resolve();
  f.pending[1]?.resolve(identity(2));
  expect(await second).toEqual(identity(2));
  f.pending[0]?.resolve(identity(1));
  expect(await first).toBeNull();
  expect(f.cache.lookup("fake")?.connectionEpoch).toBe(2);
  f.cache.dispose();
  expect(f.cache.lookup("fake")).toBeNull();
});

test("connection epoch reuse, foreign Host, malformed identity and absent old-peer access fail closed", async () => {
  const f = fixture();
  const first = f.cache.refresh("fake");
  await Promise.resolve();
  f.pending[0]?.resolve(identity());
  await first;
  f.replace();
  const reused = f.cache.refresh("fake");
  await Promise.resolve();
  f.pending[1]?.resolve(identity());
  expect(await reused).toBeNull();
  f.cache.dispose();

  for (const value of [
    null,
    { ...identity(), hostId: P.HostId.make("foreign") },
    { ...identity(), connectionEpoch: 0 },
    { ...identity(), clientId: "" },
  ]) {
    const bad = fixture();
    const result = bad.cache.refresh("fake");
    await Promise.resolve();
    bad.pending[0]?.resolve(value);
    expect(await result).toBeNull();
    expect(bad.cache.lookup("fake")).toBeNull();
    bad.cache.dispose();
  }
});

test("abort, removed Host and capability absence cancel without fetching or idle retry", async () => {
  const f = fixture();
  const result = f.cache.refresh("fake");
  await Promise.resolve();
  f.abort.abort();
  expect(await result).toBeNull();
  expect(f.cache.lookup("fake")).toBeNull();
  f.pending[0]?.resolve(identity());
  f.connection(null);
  expect(await f.cache.refresh("fake")).toBeNull();
  f.connection({
    token: {},
    hostId: P.HostId.make("fake"),
    signal: new AbortController().signal,
    languages: false,
  });
  expect(await f.cache.refresh("fake")).toBeNull();
  expect(f.pending).toHaveLength(1);
  f.cache.dispose();
});

test("ignored cancellation retains bounded lookup capacity until actual settlement", async () => {
  const f = fixture(1);
  const results = Array.from({ length: 33 }, (_, index) => f.cache.refresh(`host-${index}`));
  await Promise.all(results);
  expect(f.pending).toHaveLength(32);
  f.replace();
  expect(await f.cache.refresh("next")).toBeNull();
  expect(f.pending).toHaveLength(32);

  for (const item of f.pending) item.resolve(null);
  f.cache.dispose();
});

test("disposal before lookup admission never calls the injected Main port", async () => {
  const f = fixture();
  const result = f.cache.refresh("fake");
  f.cache.dispose();
  expect(await result).toBeNull();
  expect(f.pending).toHaveLength(0);
});
