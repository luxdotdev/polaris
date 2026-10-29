/**
 * The agent's todo list in the notice strip (DESIGN.md, The composer): the Turn in flight's
 * latest `Plan` item, which every Harness driver makes from its list (Claude Code's TodoWrite,
 * Codex's plan updates, OpenCode's todowrite). Gone once every item is done or the Turn ends.
 */
import type { TurnItem, TurnStatus } from "@polaris/protocol";
import { Predicate } from "effect";
import type { LiveItem } from "../../../store/sessionModel.ts";
import type { PlanStep } from "./items.ts";
import { stepLabel } from "./meta.ts";

/** What of a Turn the list reads (a `TurnView` is one); a Subagent's own list stays out. */
export interface PlanTurn {
  readonly turn: { readonly status: TurnStatus };
  readonly items: ReadonlyArray<TurnItem>;
  readonly live: ReadonlyMap<string, LiveItem>;
}

export interface TodoList {
  readonly steps: ReadonlyArray<PlanStep>;
  /** The item in progress, else the next one not done; what the strip reads. */
  readonly current: number;
  readonly label: string;
  readonly done: number;
}

type PlanItem = Extract<TurnItem, { _tag: "Plan" }>;

const isPlan = (item: TurnItem | null): item is PlanItem =>
  item !== null && Predicate.isTagged(item, "Plan");

/** The latest list: the one still updating, else the last one completed in the Turn. */
const latestPlan = (turn: PlanTurn): PlanItem | undefined =>
  [...turn.live.values()].map((l) => l.item).findLast(isPlan) ?? turn.items.findLast(isPlan);

/** The todo list of the latest Turn while it works, until every item is done. */
export const todoList = (turn: PlanTurn | undefined): TodoList | null => {
  if (turn === undefined || turn.turn.status !== "working") return null;
  const steps = latestPlan(turn)?.steps ?? [];
  const inProgress = steps.findIndex((s) => s.status === "in-progress");
  const current = inProgress === -1 ? steps.findIndex((s) => s.status === "pending") : inProgress;
  const step = steps[current];

  if (step === undefined) return null;

  return {
    steps,
    current,
    label: stepLabel(step),
    done: steps.filter((s) => s.status === "completed").length,
  };
};
