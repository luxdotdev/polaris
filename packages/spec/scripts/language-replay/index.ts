import { Match, Schema } from "effect";

const Counter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
);

const Context = Schema.Literals([0, 1]);

const Generation = Counter.check(Schema.isGreaterThan(0));

export const LanguageTraceEvent = Schema.TaggedUnion({
  Sync: {
    context: Context,
    generation: Generation,
    sequence: Counter,
    previous: Counter,
    version: Counter,
  },
  Request: { context: Context, generation: Generation, sequence: Counter, version: Counter },
  Result: { context: Context, generation: Generation, version: Counter },
  Cancel: { context: Context },
  Restart: { context: Context },
  Prepare: {},
  Apply: {},
  PersistDrafts: {},
  PersistReceipt: {},
  Acknowledge: {},
  DiskEdit: {},
  Undo: {},
  Crash: {},
});

export const LanguageTraceObservation = Schema.TaggedUnion({
  Context: {
    context: Context,
    generation: Generation,
    sequence: Counter,
    version: Counter,
    delivered: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
  },
  Operation: {
    prepared: Schema.Boolean,
    applied: Schema.Boolean,
    drafts: Schema.Boolean,
    receipt: Schema.Boolean,
    acknowledged: Schema.Boolean,
    owned: Schema.Boolean,
    restored: Schema.Boolean,
  },
});

export const LanguageTrace = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literals(["synthetic-contract", "runtime"]),
  events: Schema.Array(
    Schema.Struct({ event: LanguageTraceEvent, observed: LanguageTraceObservation })
  ).check(Schema.isMaxLength(10000)),
});

export type LanguageTrace = typeof LanguageTrace.Type;

const eventExpression = (event: typeof LanguageTraceEvent.Type): string =>
  Match.value(event).pipe(
    Match.tag(
      "Sync",
      (value) =>
        `Sync({ context: ${value.context}, generation: ${value.generation}, sequence: ${value.sequence}, previous: ${value.previous}, version: ${value.version} })`
    ),
    Match.tag(
      "Request",
      (value) =>
        `Request({ context: ${value.context}, generation: ${value.generation}, sequence: ${value.sequence}, version: ${value.version} })`
    ),
    Match.tag(
      "Result",
      (value) =>
        `Result({ context: ${value.context}, generation: ${value.generation}, version: ${value.version} })`
    ),
    Match.tag("Cancel", (value) => `Cancel(${value.context})`),
    Match.tag("Restart", (value) => `Restart(${value.context})`),
    Match.orElse((value) => value._tag)
  );

const observedExpression = (observed: typeof LanguageTraceObservation.Type): string =>
  Match.value(observed).pipe(
    Match.tag("Context", (value) => {
      const context = `contexts.get(${value.context})`;

      return `${context}.generation == ${value.generation} and ${context}.sequence == ${value.sequence} and ${context}.version == ${value.version} and ${context}.delivered == ${value.delivered}`;
    }),
    Match.tag(
      "Operation",
      (value) =>
        `operation == { prepared: ${value.prepared}, applied: ${value.applied}, drafts: ${value.drafts}, receipt: ${value.receipt}, acknowledged: ${value.acknowledged}, owned: ${value.owned}, restored: ${value.restored} }`
    ),
    Match.exhaustive
  );

/** Two abstract keys represent distinct authenticated Client/checkout/project/provider contexts. */

export const languageTraceModule = (trace: LanguageTrace, specPath: string): string =>
  [
    "module language_contract_trace {",
    `  import languages.* from ${JSON.stringify(specPath)}`,
    "  run recordedTest = init.expect(safety)",
    ...trace.events.map(
      ({ event, observed }) =>
        `    .then(publish(${eventExpression(event)})).expect(safety and (${observedExpression(observed)}))`
    ),
    "}",
  ].join("\n");

export const decodeLanguageTrace = Schema.decodeUnknownSync(LanguageTrace);
