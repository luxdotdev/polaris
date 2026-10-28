import { expect, test } from "bun:test";
import { type Capability, PresenceLease, type UserPresence } from "@polaris/protocol";
import { Effect, Fiber, SubscriptionRef } from "effect";
import { type PresenceSession, reportPresence } from "./presence.ts";

/** A connection whose Daemon answers `presence.report` with `leaseMs`, logging each report. */
const connection = (
  name: string,
  log: Array<string>,
  leaseMs: number,
  capabilities: ReadonlyArray<Capability> = ["presence"]
): PresenceSession => ({
  capabilities,
  client: {
    "presence.report": ({ presence }: { readonly presence: UserPresence }) =>
      Effect.sync(() => {
        log.push(`${name}:${presence}`);

        return new PresenceLease({ leaseMs: presence === "present" ? leaseMs : 0 });
      }),
  },
});

const run = (
  body: (input: {
    readonly setSession: (session: PresenceSession | null) => Effect.Effect<void>;
    readonly setPresence: (presence: UserPresence) => Effect.Effect<void>;
  }) => Effect.Effect<void>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* SubscriptionRef.make<PresenceSession | null>(null);
      const presence = yield* SubscriptionRef.make<UserPresence>("away");

      const fiber = yield* Effect.forkChild(
        reportPresence(SubscriptionRef.changes(session), SubscriptionRef.changes(presence))
      );

      const settle = Effect.sleep("20 millis");

      yield* body({
        setSession: (next) => Effect.andThen(SubscriptionRef.set(session, next), settle),
        setPresence: (next) => Effect.andThen(SubscriptionRef.set(presence, next), settle),
      });
      yield* Fiber.interrupt(fiber);
    })
  );

test("present is reported, renewed at half the lease, and ended with away", async () => {
  const log: Array<string> = [];

  await run(({ setSession, setPresence }) =>
    Effect.gen(function* () {
      yield* setSession(connection("mac", log, 100));
      expect(log).toEqual([]);
      yield* setPresence("present");
      yield* Effect.sleep("100 millis");
      yield* setPresence("away");
    })
  );

  expect(log[0]).toBe("mac:present");
  expect(log.filter((entry) => entry === "mac:present").length).toBeGreaterThanOrEqual(2);
  expect(log.at(-1)).toBe("mac:away");
});

test("a new connection while present is told at once; one while away is told nothing", async () => {
  const log: Array<string> = [];

  await run(({ setSession, setPresence }) =>
    Effect.gen(function* () {
      yield* setPresence("present");
      yield* setSession(connection("first", log, 60_000));
      yield* setSession(connection("second", log, 60_000));
      yield* setPresence("away");
      yield* setSession(connection("third", log, 60_000));
    })
  );

  expect(log).toEqual(["first:present", "second:present", "second:away"]);
});

test("a Host without the presence capability is told nothing", async () => {
  const log: Array<string> = [];

  await run(({ setSession, setPresence }) =>
    Effect.gen(function* () {
      yield* setSession(connection("old", log, 60_000, []));
      yield* setPresence("present");
      yield* setPresence("away");
    })
  );

  expect(log).toEqual([]);
});

test("a repeated present is not reported again", async () => {
  const log: Array<string> = [];

  await run(({ setSession, setPresence }) =>
    Effect.gen(function* () {
      yield* setSession(connection("mac", log, 60_000));
      yield* setPresence("present");
      yield* setPresence("present");
    })
  );

  expect(log).toEqual(["mac:present"]);
});
