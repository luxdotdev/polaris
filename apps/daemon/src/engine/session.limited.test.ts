import { describe, expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
import { Predicate } from "effect";
import {
  AT,
  initialSnapshot,
  type ModelOptions,
  type ModelSnapshot,
  RESETS_AT,
  type Step,
  stepModel,
} from "./session.testing.ts";
import { decideSession, stateOf } from "./session.ts";

const claude: ModelOptions = { harness: "claude", liveCoAttach: false, switchModel: false };

const codex: ModelOptions = { harness: "codex", liveCoAttach: true, switchModel: true };

const run = (steps: ReadonlyArray<Step["type"]>, options = claude): ModelSnapshot => {
  let snapshot = initialSnapshot();

  for (const type of steps) {
    const { next, rejection } = stepModel(snapshot, { type }, options);

    if (rejection !== null) throw new Error(`${type}: ${rejection}`);
    snapshot = next;
  }

  return snapshot;
};

const record = (snapshot: ModelSnapshot) => snapshot.machine.context.record!;

const refusal = (snapshot: ModelSnapshot, type: Step["type"]) =>
  stepModel(snapshot, { type }, claude).rejection;

describe("Limited", () => {
  test("a Turn stopped at a usage limit is Interrupted and the session Limited until the reset", () => {
    const limited = run(["start", "limitTurn"]);
    const r = record(limited);

    expect(stateOf(limited.machine)).toBe("limited");
    expect(r.turns.at(-1)?.status).toBe("interrupted");
    expect(r.session.limitResetsAt).toBe(RESETS_AT);
    // Only Failed keeps the Harness's error as lastError; Limited reads "Usage limit".
    expect(r.session.lastError).toBeNull();
  });

  test("the state change carries the reset time, and leaving Limited clears it", () => {
    const working = record(run(["start"]));

    const decision = decideSession(working, {
      type: "harness.turnEnded",
      turnId: working.turns[0]!.id,
      status: "failed",
      error: "usage limit",
      checkpoint: null,
      limit: { resetsAt: null },
      at: AT,
    });

    const changed = decision.events.find(Predicate.isTagged("SessionStateChanged"));
    expect(changed).toMatchObject({ state: "limited", reason: "usage limit", resetsAt: null });
    expect(record(run(["start", "limitTurn", "continue"])).session.limitResetsAt).toBeNull();
  });

  test("Continue picks the same Turn up; a new Turn starts fresh; Retry has nothing to retry", () => {
    const limited = run(["start", "limitTurn"]);
    const continued = record(run(["start", "limitTurn", "continue"]));

    expect(continued.session.state).toBe("working");
    expect(continued.turns.map((t) => t.status)).toEqual(["working"]);
    expect(record(run(["start", "limitTurn", "send"])).turns.map((t) => t.status)).toEqual([
      "interrupted",
      "working",
    ]);
    expect(refusal(limited, "retry")).toBe("there is no Failed Turn to retry");
    expect(refusal(limited, "openTerminal")).toBeNull();
    expect(refusal(limited, "archive")).toBeNull();
  });

  test("a restart and an exiting Harness leave it Limited, reset time kept", () => {
    for (const steps of [
      ["start", "limitTurn", "restart"],
      ["start", "limitTurn", "exit"],
      ["start", "limitTurn", "crash"],
    ] as const) {
      const r = record(run(steps));
      expect(r.session.state).toBe("limited");
      expect(r.session.limitResetsAt).toBe(RESETS_AT);
    }
  });

  test("a background continuation from the live Harness means the limit lifted", () => {
    const limited = record(run(["start", "limitTurn"], codex));

    const decision = decideSession(limited, {
      type: "harness.turnStarted",
      turnId: TurnId.make("auto-after-reset"),
      prompt: "",
      trigger: null,
      at: AT,
    });

    expect(stateOf(decision.next)).toBe("working");
  });

  test("a failed Turn with no limit still Fails; In Terminal a limit changes no state", () => {
    expect(stateOf(run(["start", "failTurn"]).machine)).toBe("failed");
    const following = run(["start", "complete", "openTerminal", "terminalTurn", "limitTurn"]);
    expect(stateOf(following.machine)).toBe("in-terminal");
    expect(record(following).turns.at(-1)?.status).toBe("failed");
  });
});
