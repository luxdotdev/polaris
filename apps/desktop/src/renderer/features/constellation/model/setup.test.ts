import { describe, expect, test } from "bun:test";
import { HostId, SessionId, WorkerPlacement } from "@polaris/protocol";
import { asPlain } from "../../../store/plain.ts";
import { CONSTELLATION, STUDIO } from "../preview/graph.ts";
import { setupRecord, setupRun, setupSessions } from "../preview/setup.ts";
import { attentionItems } from "./attention.ts";
import { plainFacts } from "./facts.ts";
import { buildRail, type RailRow } from "./rail.ts";
import { currentSetup, retrySetup, type SetupSession, setupsOf } from "./setup.ts";
import type { TaskRow } from "./task.ts";

const source = (sessions: ReadonlyArray<SetupSession>, hostId: string = STUDIO) => ({
  hostKey: hostId === STUDIO ? "local" : "devbox",
  hostId,
  hostLabel: hostId === STUDIO ? "Mac Studio" : "devbox",
  sessions,
});

const setups = setupsOf([source(setupSessions)], CONSTELLATION, STUDIO);

const facts = plainFacts({ setup: (taskId) => setups.get(taskId) ?? null });

const rowFor = (rows: ReadonlyArray<RailRow>, id: string) =>
  rows.find((r): r is TaskRow => r.kind === "task" && r.task.id === id);

describe("worktree setup", () => {
  const rail = buildRail(setupRecord(), facts);

  test("a running setup reads as setting up, neutral, with its command and age", () => {
    const row = rowFor(rail.rows, "B7");

    expect(row?.look).toMatchObject({ glyph: "waiting", word: "setting up", bucket: "working" });
    expect(row?.look.attention).toBeNull();
    expect(row?.line).toMatchObject({ kind: "setup", failed: false, command: "bun install" });
    expect(row?.line?.kind === "setup" ? row.line.duration : null).toBe("1m");
  });

  test("a failed setup needs you, ranked with a silent end (4), with no Attempt", () => {
    const row = rowFor(rail.rows, "B8");

    expect(row?.attempt).toBeNull();
    expect(row?.look).toMatchObject({ glyph: "needs-you", word: "setup failed" });
    expect(row?.line).toMatchObject({ kind: "setup", failed: true, exitCode: 1 });

    expect(attentionItems(rail.tasks, facts).map((i) => [i.text, i.rank])).toEqual([
      ["B8 setup failed · bun install exited 1", 4],
    ]);
  });

  test("the latest run per Task wins, archived Sessions are history", () => {
    const [running, failed] = setupSessions;

    if (running === undefined || failed === undefined) throw new Error("fixtures");

    const older = {
      ...asPlain(failed),
      id: SessionId.make("s-b8-old"),
      worktreeSetup: setupRun("B8", "failed", 30, 2),
    };

    const archived = {
      ...asPlain(running),
      id: SessionId.make("s-b7-new"),
      state: "archived",
      worktreeSetup: setupRun("B7", "failed", 0, 1),
    };

    const map = setupsOf([source([older, failed, archived, running])], CONSTELLATION, STUDIO);

    expect(map.get("B8")?.sessionId).toBe(failed.id);
    expect(map.get("B7")?.sessionId).toBe(running.id);
  });

  test("a later Harness error isn't a setup failure; a newer Attempt supersedes the run", () => {
    const failed = setupSessions[1];

    if (failed === undefined) throw new Error("fixtures");

    const harness = { ...asPlain(failed), lastError: "codex exited" };
    const fact = setupsOf([source([harness])], CONSTELLATION, STUDIO).get("B8") ?? null;

    expect(fact?.failed).toBe(false);
    expect(currentSetup(fact, null)).toBeNull();

    const current = setups.get("B8") ?? null;

    expect(currentSetup(current, null)).toBe(current);
    expect(currentSetup(current, { startedAt: new Date().toISOString() })).toBeNull();
  });

  test("retry reuses the worker Session on the Lead's Host, a new worker elsewhere", () => {
    const local = setups.get("B8");

    if (local === undefined) throw new Error("fixtures");

    expect(retrySetup(local, STUDIO).tasks[0]?.worker).toEqual(
      WorkerPlacement.cases.Existing.make({ sessionId: local.sessionId })
    );

    const remote = setupsOf([source(setupSessions, "h-devbox")], CONSTELLATION, STUDIO).get("B8");

    expect(remote?.remoteHost).toBe("devbox");
    expect(remote === undefined ? null : retrySetup(remote, STUDIO).tasks[0]?.worker).toEqual(
      WorkerPlacement.cases.New.make({ hostId: HostId.make("h-devbox") })
    );
  });
});
