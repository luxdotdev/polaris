/**
 * The credit window (`byteStreamFlow.ts`): a peer may only send what we have granted, and a
 * grant beyond what is outstanding, or that is not a positive integer, is refused so a bad peer
 * cannot inflate the window (ENG-613, ADR 0093, the Codex review of the contracts).
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import { makeCreditWindow } from "./byteStreamFlow.ts";
import { TransportError } from "./wire.ts";

describe("makeCreditWindow", () => {
  test("a reserve past the window waits until the peer grants what it consumed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const window = makeCreditWindow(100);
        yield* window.reserve(100);
        expect(window.outstanding()).toBe(100);

        let resumed = false;

        const waiting = yield* Effect.forkChild(
          window.reserve(40).pipe(Effect.ensuring(Effect.sync(() => (resumed = true))))
        );

        yield* Effect.sleep("20 millis");
        const blockedWhileFull = resumed;

        expect(window.grant(40)).toBe(true);
        yield* Fiber.join(waiting);

        return { blockedWhileFull, resumed, outstanding: window.outstanding() };
      })
    ).then((result) => {
      expect(result.blockedWhileFull).toBe(false);
      expect(result.resumed).toBe(true);
      expect(result.outstanding).toBe(100);
    });
  });

  test("grant is refused beyond what is outstanding, or when not a positive integer", () => {
    const window = makeCreditWindow(100);
    Effect.runSync(window.reserve(60));

    // 60 sent, 60 outstanding: 61 would credit a byte never sent.
    expect(window.grant(61)).toBe(false);
    expect(window.grant(0)).toBe(false);
    expect(window.grant(-5)).toBe(false);
    expect(window.grant(1.5)).toBe(false);
    expect(window.grant(Number.NaN)).toBe(false);
    // The refusals left the window untouched.
    expect(window.outstanding()).toBe(60);

    expect(window.grant(60)).toBe(true);
    expect(window.outstanding()).toBe(0);
  });

  test("a failure fails every waiting and future reserve", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const window = makeCreditWindow(10);
        yield* window.reserve(10);
        const waiting = yield* Effect.forkChild(window.reserve(5).pipe(Effect.exit));
        yield* Effect.sleep("10 millis");

        window.fail(new TransportError({ message: "connection lost" }));

        return {
          waiting: yield* Fiber.join(waiting),
          future: yield* window.reserve(1).pipe(Effect.exit),
        };
      })
    ).then((result) => {
      expect(Exit.isFailure(result.waiting)).toBe(true);
      expect(Exit.isFailure(result.future)).toBe(true);
    });
  });
});
