/**
 * Command ids for mutating tool calls, so a retried call never acts twice. An explicit
 * `requestId` makes the id a pure function of the session, tool, key and input, so the
 * store's receipts deduplicate it for good. Without one, an identical call from the same
 * session within `RETRY_WINDOW_MS` of an unrejected one reuses its id: a Harness retry
 * after a timeout lands on the same receipt, while the same note sent later still acts.
 */
import { CommandId, type SessionId } from "@polaris/protocol";
import { Context, Effect, Option, Schema } from "effect";

export const RETRY_WINDOW_MS = 5 * 60_000;

const KEPT = 256;

export const RequestId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200)
).annotate({
  description:
    "Optional idempotency key. Reuse it, with the same input, when retrying a call whose result you did not see; Polaris then acts once.",
});

/** The id the current call's commands commit under; none outside a mutating call. */
export class CallCommandId extends Context.Reference<CommandId | null>(
  "polaris/mcp/CallCommandId",
  { defaultValue: () => null }
) {}

const JsonObject = Schema.Record(Schema.String, Schema.Json);

const decodeObject = Schema.decodeUnknownOption(JsonObject);

/** Objects with sorted keys, so the same input always hashes the same. */
const canonical = (value: typeof Schema.Json.Type): typeof Schema.Json.Type => {
  if (Array.isArray(value)) return value.map(canonical);

  return Option.match(decodeObject(value), {
    onNone: () => value,
    onSome: (object) =>
      Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, canonical(object[key] ?? null)])
      ),
  });
};

const digest = (parts: ReadonlyArray<string>) =>
  new Bun.CryptoHasher("sha256").update(parts.join("\u0000")).digest("hex");

interface Recent {
  readonly id: CommandId;
  readonly at: number;
}

/** One per tool catalog owner (a Daemon's commands); holds recent implicit ids. */
export const idempotency = (now: () => number = Date.now) => {
  const recent = new Map<string, Recent>();

  const prune = (at: number) => {
    for (const [key, entry] of recent)
      if (at - entry.at > RETRY_WINDOW_MS || recent.size > KEPT) recent.delete(key);
  };

  /** The id for one call, and a callback that forgets it when the call was rejected. */
  const begin = (
    sessionId: SessionId,
    tool: string,
    requestId: string | undefined,
    input: typeof Schema.Json.Type
  ) => {
    const body = JSON.stringify(canonical(input));

    if (requestId !== undefined)
      return {
        id: CommandId.make(`mcp:${digest([sessionId, tool, requestId, body])}`),
        rejected: () => {},
      };

    const at = now();
    prune(at);
    const key = digest([sessionId, tool, body]);
    const known = recent.get(key);
    const id = known?.id ?? CommandId.make(`mcp:${crypto.randomUUID()}`);
    recent.set(key, { id, at });

    return {
      id,
      rejected: () => {
        if (recent.get(key)?.id === id) recent.delete(key);
      },
    };
  };

  return { begin };
};

export type Idempotency = ReturnType<typeof idempotency>;

/** Separates the key from the tool's own input; a malformed key fails like any input. */
export const splitRequestId = (
  input: typeof Schema.Json.Type
): Effect.Effect<
  { readonly requestId: string | undefined; readonly rest: typeof Schema.Json.Type },
  Schema.SchemaError
> =>
  Option.match(decodeObject(input), {
    onNone: () => Effect.succeed({ requestId: undefined, rest: input }),
    onSome: ({ requestId, ...rest }) =>
      requestId === undefined
        ? Effect.succeed({ requestId: undefined, rest: input })
        : Schema.decodeUnknownEffect(RequestId)(requestId).pipe(
            Effect.map((requestId) => ({ requestId, rest }))
          ),
  });
