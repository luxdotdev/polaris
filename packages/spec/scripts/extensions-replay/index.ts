/**
 * Trace validation for Extensions (ENG-398): a runtime trace of what the real
 * Daemon answered to pairing, hello, gated calls, revocation and closes, as
 * `transport/extensions.test.ts` observed it over a socket. `replayExtensions`
 * replays it through a reference of `extensions.qnt`; `toQuint` writes the
 * same decisions as a Quint run that `replay-extensions.ts` checks with the spec.
 */
import { Match, Schema } from "effect";

export const GrantName = Schema.Literals(["read", "approve", "turn", "start", "voice"]);

/** What a call needs: anyone, token-less Clients only, or a Grant. */
export const Need = Schema.Literals(["open", "client", ...GrantName.literals]);

export type Need = typeof Need.Type;

const Counter = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ExtensionsTraceEvent = Schema.TaggedUnion({
  Pair: { pairing: Counter, grant: Schema.Array(GrantName) },
  Revoke: { pairing: Counter, observed: Schema.Literals(["ok", "unknown"]) },
  /** `pairing` null: a token-less hello. */
  Hello: {
    connection: Counter,
    pairing: Schema.NullOr(Counter),
    observed: Schema.Literals(["ok", "refused"]),
  },
  /** `observed`: `allowed`, `refused:<grant>`, `not-for-extensions` or `dropped`. */
  Call: { connection: Counter, need: Need, observed: Schema.String },
  Close: { connection: Counter },
});

export type ExtensionsTraceEvent = typeof ExtensionsTraceEvent.Type;

type EventOf<Tag extends ExtensionsTraceEvent["_tag"]> = Extract<
  ExtensionsTraceEvent,
  { _tag: Tag }
>;

export const ExtensionsTrace = Schema.Struct({
  format: Schema.Literal("extensions-v1"),
  provenance: Schema.Literal("runtime-socket"),
  events: Schema.Array(ExtensionsTraceEvent),
});

export type ExtensionsTrace = typeof ExtensionsTrace.Type;

export const decodeExtensionsTrace = Schema.decodeUnknownSync(ExtensionsTrace);

// ── The reference (extensions.qnt) ──────────────────────────────────────────

interface Reference {
  readonly pairings: Map<number, { readonly grant: ReadonlyArray<string>; revoked: boolean }>;
  readonly scoped: Map<number, number>;
  readonly closed: Set<number>;
}

const mismatch = (event: ExtensionsTraceEvent, expected: string) =>
  new Error(
    `Extensions trace observation mismatch: ${JSON.stringify(event)} should observe ${expected}`
  );

const check = (event: ExtensionsTraceEvent, observed: string, expected: string) => {
  if (observed !== expected) throw mismatch(event, expected);
};

const pair = (ref: Reference, event: EventOf<"Pair">) => {
  if (ref.pairings.has(event.pairing)) throw mismatch(event, "a fresh Pairing id");
  ref.pairings.set(event.pairing, { grant: event.grant, revoked: false });
};

const close = (ref: Reference, connection: number) => {
  ref.scoped.delete(connection);
  ref.closed.add(connection);
};

const revoke = (ref: Reference, event: EventOf<"Revoke">) => {
  const pairing = ref.pairings.get(event.pairing);
  check(event, event.observed, pairing === undefined ? "unknown" : "ok");

  if (pairing === undefined) return;
  pairing.revoked = true;

  for (const [connection, scopedTo] of ref.scoped) {
    if (scopedTo === event.pairing) close(ref, connection);
  }
};

const hello = (ref: Reference, event: EventOf<"Hello">) => {
  if (ref.closed.has(event.connection)) throw mismatch(event, "nothing: it is closed");
  const pairing = event.pairing === null ? undefined : ref.pairings.get(event.pairing);
  const refused = event.pairing !== null && (pairing === undefined || pairing.revoked);
  check(event, event.observed, refused ? "refused" : "ok");

  if (!refused && event.pairing !== null && !ref.scoped.has(event.connection))
    ref.scoped.set(event.connection, event.pairing);
};

const expectedCall = (ref: Reference, event: EventOf<"Call">): string => {
  if (ref.closed.has(event.connection)) return "dropped";
  const pairing = ref.scoped.get(event.connection);

  if (pairing === undefined || event.need === "open") return "allowed";

  if (event.need === "client") return "not-for-extensions";

  return ref.pairings.get(pairing)?.grant.includes(event.need)
    ? "allowed"
    : `refused:${event.need}`;
};

const apply = (ref: Reference, event: ExtensionsTraceEvent): void =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      Pair: (e) => pair(ref, e),
      Revoke: (e) => revoke(ref, e),
      Hello: (e) => hello(ref, e),
      Call: (e) => check(e, e.observed, expectedCall(ref, e)),
      Close: (e) => close(ref, e.connection),
    })
  );

/** Replays the trace through the reference and throws on the first observation it disputes. */
export const replayExtensions = (trace: ExtensionsTrace): void => {
  const ref: Reference = { pairings: new Map(), scoped: new Map(), closed: new Set() };

  for (const event of trace.events) apply(ref, event);
};

// ── The same decisions as a Quint run ───────────────────────────────────────

const q = (s: string) => JSON.stringify(s);

const quintNeed = (need: Need): string =>
  Match.value(need).pipe(
    Match.withReturnType<string>(),
    Match.when("open", () => "Open"),
    Match.when("client", () => "ClientOnly"),
    Match.orElse((grant) => `Needs(${q(grant)})`)
  );

const quintCallOutcome = (observed: string): string => {
  if (observed === "allowed") return "Allowed";

  if (observed === "not-for-extensions") return "NotForExtensions";

  if (observed === "dropped") return "Dropped";

  if (observed.startsWith("refused:")) return `Refused(${q(observed.slice("refused:".length))})`;
  throw new Error(`unknown Call observation ${observed}`);
};

const quintStep = (event: ExtensionsTraceEvent): string =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      Pair: (e) => `.then(pair(${e.pairing}, Set(${e.grant.map(q).join(", ")})))`,
      Revoke: (e) =>
        `.then(revoke(${e.pairing})).expect(last == ${e.observed === "ok" ? "RevokeOk" : "RevokeUnknown"})`,
      Hello: (e) =>
        `.then(hello(${e.connection}, ${e.pairing ?? "NONE"})).expect(last == ${e.observed === "ok" ? "HelloOk" : "HelloRefused"})`,
      Call: (e) =>
        `.then(call(${e.connection}, ${quintNeed(e.need)})).expect(last == ${quintCallOutcome(e.observed)} and safety)`,
      Close: (e) => `.then(close(${e.connection}))`,
    })
  );

/** The trace as a Quint run module importing the spec from the directory above. */
export const toQuint = (name: string, trace: ExtensionsTrace): string =>
  [
    `module ${name} {`,
    `  import extensions.* from "../extensions"`,
    `  run replayTest = init`,
    ...trace.events.map((event) => `    ${quintStep(event)}`),
    `    .expect(safety)`,
    `}`,
    ``,
  ].join("\n");
