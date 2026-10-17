/**
 * ENG-264 on fixtures (`#constellation/startup`): B2 stalled on a held slot with its setup done,
 * B3 just granted its slot and starting, F1b queued for a slot.
 */
import type { AgentSession } from "@polaris/protocol";
import type { WorkerFacts } from "../model/index.ts";
import { worker } from "./graph.ts";
import { session } from "./sessions.ts";
import { setupRun } from "./setup.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const notStarted = { activeTurn: false, firstTurn: false, activity: null, subagents: [] };

export const STARTUP_SIGNALS = new Map<string, Partial<WorkerFacts>>([
  ["att-B2-1", { ...notStarted, slotHeldSince: ago(12) }],
  ["att-B3-1", { ...notStarted, slotHeldSince: ago(0.3) }],
  ["att-F1b-1", { activity: { kind: "slot", host: null, since: ago(3) } }],
]);

const SET_UP = new Map([
  [worker("B2"), setupRun("B2", "completed", 40, 0)],
  [worker("B3"), setupRun("B3", "completed", 25, 0)],
]);

/** B2's and B3's setups completed before their Attempts started. */
export const withStartupSetups = (s: AgentSession): AgentSession => {
  const run = SET_UP.get(s.id);

  return run === undefined
    ? s
    : session(s.id, {
        title: s.title,
        state: s.state,
        contextUsage: s.contextUsage,
        worktreeSetup: run,
      });
};
