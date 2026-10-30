import { describe, expect, test } from "bun:test";
import { ConstellationId, SessionId } from "@polaris/protocol";
import { session } from "../push/push.testing.ts";
import { patchSession } from "../store/model.ts";
import { CID, dispatched, LEAD } from "./constellation.testing.ts";
import { markedWorker, workerSessions } from "./workers.ts";

const WORKER = SessionId.make("worker");

describe("worker sessions", () => {
  test("a worker made before the mark is marked with its Constellation; its Lead isn't", () => {
    const workers = workerSessions({ constellations: new Map([[CID, dispatched()]]) });

    const marked = (id: SessionId) => markedWorker(patchSession(session, { id }), workers).worker;

    expect([marked(WORKER), marked(LEAD)]).toEqual([{ constellationId: CID }, null]);
  });

  test("a session that leads another Constellation isn't a worker there either", () => {
    const attempts: ReadonlyArray<{ readonly sessionId: SessionId }> = [];
    const second = { graph: { id: ConstellationId.make("c2"), leadSessionId: WORKER, attempts } };

    const workers = workerSessions({
      constellations: new Map([
        [CID, dispatched()],
        ["c2", second],
      ]),
    });

    expect(workers.has(WORKER)).toBe(false);
  });
});
