import { expect, test } from "bun:test";
import { Effect } from "effect";
import { openThread } from "../thread/controller.ts";
import { makeFakeHost, sessionId, snapshot, turn } from "../thread/daemon.testing.ts";
import { teammateThreadSource } from "./source.ts";

const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 40)));

const ALL = new Set([
  "session.steer",
  "session.continuity",
  "review.risk-summary",
  "session.turn-paging",
]);

test("a Teammate's thread opens without asking for what only the owner keeps", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* makeFakeHost();

        const thread = openThread(teammateThreadSource(host.live, ALL), sessionId, {
          draftDelayMs: 10,
        });

        yield* host.push(
          snapshot([{ turn: turn(0, { checkpointAfter: "ref-0", checkpointAfterCommit: "c0" }) }])
        );
        yield* settle;
        thread.type("a draft stays on this phone");
        yield* settle;
        yield* settle;

        // A Share refuses drafts, read positions and Risk Summaries (SHARE_RPCS).
        expect(thread.get().fold?.turns.length).toBe(1);
        expect(host.saved).toEqual([]);
        expect(host.reads).toEqual([]);
        expect(host.summariesAsked).toEqual([]);
        thread.dispose();
      })
    )
  ));
