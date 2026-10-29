import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { conversationRows, type Folds, summarize } from "./conversation.ts";
import { groupTurns } from "./turnGroups.ts";

const view = (turn: Parameters<typeof turnWith>[0], items: ReadonlyArray<TurnItem> = []) => ({
  turn: turnWith(turn),
  items,
  live: new Map(),
  subagents: [],
});

const prompted: TurnView = view(
  { id: TurnId.make("t0"), index: 0, prompt: "Refactor the parser", status: "completed" },
  [TurnItem.cases.AssistantMessage.make({ id: "m0", text: "Done: the parser is split" })]
);

const compaction = (status: "working" | "completed"): TurnView =>
  view({ id: TurnId.make("t1"), index: 1, prompt: "/compact", idleCompaction: true, status });

const allOpen: Folds = { chosen: new Map(), openFrom: TurnId.make("t0") };

describe("idle compaction's Turn in the transcript", () => {
  test("a quiet line in Claude Code's words inside the Turn before it, never the user's /compact", () => {
    const session = [prompted, compaction("completed")];
    const rows = conversationRows({ turns: session, approvals: [], folds: allOpen });

    expect(rows.filter((r) => r.kind === "prompt").map((r) => r.text)).toEqual([
      "Refactor the parser",
    ]);
    expect(rows.flatMap((r) => (r.kind === "trigger" ? [r.text] : []))).toEqual([
      "Compacted while idle, before the prompt cache expired",
    ]);
    expect(groupTurns(session).map((g) => g.number)).toEqual([1]);
  });

  test("while it runs, it says it is compacting", () => {
    const rows = conversationRows({
      turns: [prompted, compaction("working")],
      approvals: [],
      folds: allOpen,
    });

    expect(rows.flatMap((r) => (r.kind === "trigger" ? [r.text] : []))).toEqual([
      "Compacting while idle, before the prompt cache expires",
    ]);
  });

  test("a compaction with no Turn before it loaded reads as the note, not /compact", () => {
    const [group] = groupTurns([compaction("completed")]);

    expect(summarize(group!).summary).toBe("Compacted while idle, before the prompt cache expired");
  });
});
