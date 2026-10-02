import { expect, test } from "bun:test";
import { ApprovalRequest, RequestId } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { CID } from "./constellation.testing.ts";
import { recoveryCandidates, recoverSession } from "./recovery.constellation.ts";
import { setup, world, WORKER, send, signal } from "../constellation/delivery/testing.ts";

test("approval eligibility is recorded before daemon recovery withdraws approvals; user interruption is not proof", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      yield* send(WORKER);
      const store = yield* EventStore;
      const turn = (yield* store.model).sessions.get(WORKER)!.turns.at(-1)!;
      yield* signal(WORKER, { type: "harness.opened" });
      yield* signal(WORKER, {
        type: "harness.approvalRequested",
        request: new ApprovalRequest({
          id: RequestId.make("approval"),
          sessionId: WORKER,
          turnId: turn.id,
          kind: "file-change",
          title: "Edit",
          detail: null,
          options: [],
          openedAt: new Date().toISOString(),
        }),
      });
      // The recovery adapter uses only the EventStore; the production runtime supplies the rest.
      const runtime = { store };
      yield* recoverSession(runtime, WORKER, "upgrade", new Date().toISOString());
      const model = yield* store.model;
      expect(model.sessions.get(WORKER)!.pending.size).toBe(0);
      expect(model.constellations.get(CID)!.interruptions.values().next().value?.eligible).toBe(
        false
      );
      expect(recoveryCandidates(model)).toEqual([]);
      yield* signal(WORKER, { type: "turn.continue" });
      yield* signal(WORKER, { type: "harness.opened" });
      yield* signal(WORKER, {
        type: "harness.turnEnded",
        turnId: turn.id,
        status: "interrupted",
        error: null,
        checkpoint: null,
        at: new Date(Date.now() + 1).toISOString(),
      });
      expect(recoveryCandidates(yield* store.model)).toEqual([]);
    })
  );
});
