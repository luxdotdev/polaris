/**
 * The real user access registry against `packages/spec/user-access.qnt` (ENG-927): random hellos,
 * open user-only streams, allows, denies, revokes, closes, and deletions and emptyings of the
 * enrolment file, compared step by step with a reference that transcribes the spec's actions.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostId, UserAccessId } from "@polaris/protocol";
import { Redacted } from "effect";
import fc from "fast-check";
import { tempDir } from "../platform/tempDir.testing.ts";
import { digestOf } from "../userAccess/file.ts";
import { userAccessRegistry } from "../userAccess/index.ts";
import { pbtRuns, pbtSeed, pbtTimeout } from "./pbt.ts";

const runs = pbtRuns(300);

const CONNECTIONS = [0, 1, 2, 3];

const NO_KEY = 0;

const MAX_REQUESTS = 2;

const hostId = HostId.make("host-model");

const keyOf = (k: number) => k.toString(16).padStart(64, "0");

const digest = (k: number) => digestOf(hostId, keyOf(k));

const idOf = (k: number) => UserAccessId.make(digest(k).slice(0, 16));

const step = fc.record({
  action: fc.constantFrom(
    "hello",
    "hello",
    "watch",
    "allow",
    "deny",
    "revoke",
    "close",
    "forget",
    "emptied"
  ),
  c: fc.constantFrom(...CONNECTIONS),
  k: fc.integer({ min: 0, max: 3 }),
});

type Step = typeof step extends fc.Arbitrary<infer A> ? A : never;

/** The spec's state: `stored`, `initialised`, `enrolled`, `bound`, `requests` and `streams`. */
interface Model {
  stored: Set<number>;
  initialised: boolean;
  enrolled: Set<number>;
  readonly streams: Set<number>;
  readonly bound: Map<number, number>;
  readonly requests: Set<number>;
}

const holds = (m: Model, c: number) => {
  const k = m.bound.get(c) ?? NO_KEY;

  return k !== NO_KEY && m.enrolled.has(k);
};

/** The spec's `cut`: a stream ends when its connection no longer holds. */
const cut = (m: Model) => {
  for (const c of m.streams) if (!holds(m, c)) m.streams.delete(c);
};

const unbind = (m: Model, k: number) => {
  for (const [c, held] of m.bound) if (held === k) m.bound.set(c, NO_KEY);
};

/** `hello` in the spec; the answer is whether the connection holds user access. */
const hello = (m: Model, c: number, k: number): boolean => {
  if ((m.bound.get(c) ?? NO_KEY) !== NO_KEY || k === NO_KEY) return holds(m, c);
  const first = !m.initialised;
  const known = m.stored.has(k);

  const asks =
    !first && !known && m.stored.size > 0 && (m.requests.has(k) || m.requests.size < MAX_REQUESTS);

  if (first) m.stored = new Set([k]);
  m.initialised = true;
  m.enrolled = new Set(m.stored);

  if (first || known || asks) m.bound.set(c, k);

  if (first || known) m.requests.delete(k);
  else if (asks) m.requests.add(k);
  cut(m);

  return first || known;
};

const allow = (m: Model, c: number, k: number) => {
  if (!holds(m, c) || !m.requests.has(k)) return;
  m.stored = new Set([...m.stored, k]);
  m.initialised = true;
  m.enrolled = new Set(m.stored);
  m.requests.delete(k);
  cut(m);
};

const deny = (m: Model, c: number, k: number) => {
  if (!holds(m, c) || !m.requests.has(k)) return;
  m.requests.delete(k);
  unbind(m, k);
};

const revoke = (m: Model, c: number, k: number) => {
  if (!holds(m, c)) return;
  // The spec's `reread`: a revoke reads the file before it looks the key up.
  m.enrolled = new Set(m.stored);
  cut(m);

  // The spec's `revoke` is not enabled for an unknown key or the last one.
  if (!m.stored.has(k) || m.stored.size === 1) return;
  m.stored = new Set([...m.stored].filter((key) => key !== k));
  m.enrolled = new Set(m.stored);
  unbind(m, k);
  cut(m);
};

const close = (m: Model, c: number) => {
  const k = m.bound.get(c) ?? NO_KEY;

  m.bound.set(c, NO_KEY);
  m.streams.delete(c);

  if (![...m.bound.values()].includes(k)) m.requests.delete(k);
};

const standing = (m: Model, c: number) => {
  if (holds(m, c)) return "held";

  return m.requests.has(m.bound.get(c) ?? NO_KEY) ? "waiting" : "none";
};

const storedDigests = (file: string): ReadonlyArray<string> => {
  if (!existsSync(file)) return [];

  // SAFETY: the registry wrote this file; the test reads its digests only.
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    keys: ReadonlyArray<{ digest: string }>;
  };

  return parsed.keys.map((key) => key.digest).toSorted();
};

const exercise = (steps: ReadonlyArray<Step>) => {
  const file = join(tempDir("pl-ua-model-", { short: true }), "user-access.json");
  const registry = userAccessRegistry({ hostId, file, maxRequests: MAX_REQUESTS });
  // The registry knows a connection by identity only.
  const clients = CONNECTIONS.map((id) => ({ id }));
  const client = (c: number) => clients[c]!;

  const model: Model = {
    stored: new Set(),
    initialised: false,
    enrolled: new Set(),
    streams: new Set(),
    bound: new Map(CONNECTIONS.map((c) => [c, NO_KEY])),
    requests: new Set(),
  };

  // The connections whose user-only stream the registry has not ended.
  const open = new Set<number>();

  /** The gate admits a user-only stream and ends it when the registry says access is lost. */
  const watch = (c: number) => {
    if (!registry.holds(client(c)) || open.has(c)) return;
    open.add(c);
    registry.onLost(client(c), () => open.delete(c));
  };

  /** A user-only RPC: the gate lets it reach the registry only from a connection that holds. */
  const asUser = (c: number, call: () => void) => {
    if (registry.holds(client(c))) call();
  };

  const apply = ({ action, c, k }: Step) => {
    if (action === "hello") {
      const key = k === NO_KEY ? undefined : Redacted.make(keyOf(k));

      expect(registry.present(client(c), { key, label: `key ${k}` })).toBe(hello(model, c, k));
    } else if (action === "watch") {
      watch(c);

      if (holds(model, c)) model.streams.add(c);
    } else if (action === "allow") {
      asUser(c, () => {
        registry.allow(idOf(k));
      });
      allow(model, c, k);
    } else if (action === "deny") {
      asUser(c, () => {
        registry.deny(idOf(k));
      });
      deny(model, c, k);
    } else if (action === "revoke") {
      asUser(c, () => {
        registry.revoke(idOf(k));
      });
      revoke(model, c, k);
    } else if (action === "close") {
      registry.release(client(c));
      open.delete(c);
      close(model, c);
    } else if (action === "forget") {
      rmSync(file, { force: true });
      model.stored = new Set();
      model.initialised = false;
    } else {
      writeFileSync(file, JSON.stringify({ version: 2, keys: [] }));
      model.stored = new Set();
      model.initialised = true;
    }
  };

  for (const [index, next] of steps.entries()) {
    apply(next);

    const real = CONNECTIONS.map((c) => registry.stateFor(client(c)));
    const holder = real.find((state) => state.standing === "held");

    expect({
      at: index,
      holds: CONNECTIONS.map((c) => registry.holds(client(c))),
      standing: real.map((state) => state.standing),
      stored: storedDigests(file),
      streams: [...open].toSorted((a, b) => a - b),
      requests: holder?.requests.map((request) => request.id).toSorted() ?? null,
    }).toEqual({
      at: index,
      holds: CONNECTIONS.map((c) => holds(model, c)),
      standing: CONNECTIONS.map((c) => standing(model, c)),
      stored: [...model.stored].map(digest).toSorted(),
      streams: [...model.streams].toSorted((a, b) => a - b),
      requests: holder === undefined ? null : [...model.requests].map(idOf).toSorted(),
    });
  }
};

test(
  "the registry's hellos, streams, allows, denies, revokes and closes agree with the user access spec",
  () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 10, maxLength: 40 }), (steps) => exercise(steps)),
      { numRuns: runs, ...pbtSeed() }
    );
  },
  pbtTimeout(runs, 50)
);
