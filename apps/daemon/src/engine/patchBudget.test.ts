import { describe, expect, test } from "bun:test";
import { filePatch, TurnItem } from "@polaris/protocol";
import { TURN_PATCH_BUDGET, TurnPatchBudgets } from "./patchBudget.ts";

/** A completed FileChange of one file whose patch adds `lines` 63-character lines (64 KB at 1000). */
const change = (id: string, lines: number) =>
  TurnItem.cases.FileChange.make({
    id,
    changes: [
      { path: `${id}.ts`, kind: "add", patch: filePatch("", `${"x".repeat(63)}\n`.repeat(lines)) },
    ],
    status: "completed",
  });

const kept = (item: TurnItem) =>
  TurnItem.guards.FileChange(item) ? item.changes[0]?.patch : undefined;

describe("a Turn's patch budget", () => {
  test("past 2 MiB of patch text a Turn's later changes keep counts only", () => {
    const budgets = new TurnPatchBudgets();
    const size = change("probe", 1000).changes[0]?.patch?.diff.length ?? 0;
    const fit = Math.floor(TURN_PATCH_BUDGET / size);

    const items = Array.from({ length: fit + 2 }, (_, i) =>
      budgets.take("s:t1", change(`f${i}`, 1000))
    );

    expect(items.slice(0, fit).every((item) => kept(item)?.truncated === false)).toBe(true);
    expect(items.slice(fit).map(kept)).toEqual([
      { diff: "", added: 1000, removed: 0, truncated: true },
      { diff: "", added: 1000, removed: 0, truncated: true },
    ]);
  });

  test("each Turn has its own budget, and a new Turn starts afresh", () => {
    const budgets = new TurnPatchBudgets();

    const fill = (turn: string) =>
      Array.from({ length: 40 }, (_, i) => budgets.take(turn, change(`${turn}-${i}`, 1000)));

    // 40 changes of about 64 KB: past the 2 MiB budget.
    expect(kept(fill("s:t1").at(-1) ?? change("x", 0))?.truncated).toBe(true);
    expect(kept(budgets.take("s:t2", change("b", 1000)))?.truncated).toBe(false);
    budgets.end("s:t1");
    expect(kept(budgets.take("s:t1", change("d", 1000)))?.truncated).toBe(false);
  });

  test("a command's changes spend the same budget, and completing again doesn't spend twice", () => {
    const budgets = new TurnPatchBudgets();
    const patch = filePatch("", `${"x".repeat(63)}\n`.repeat(1000));
    const fit = Math.floor(TURN_PATCH_BUDGET / patch.diff.length);

    const command = (id: string) =>
      TurnItem.cases.CommandExecution.make({
        id,
        command: "python3 edit.py",
        cwd: "/w",
        output: "",
        exitCode: 0,
        status: "completed",
        changes: [{ path: `${id}.ts`, kind: "add", patch }],
      });

    const patchOf = (item: TurnItem) =>
      TurnItem.guards.CommandExecution(item) ? item.changes?.[0]?.patch : undefined;

    // The same command completes again (its result came before its snapshot): spent once.
    for (let i = 0; i < fit * 2; i++) budgets.take("s:t1", command("again"));

    for (let i = 1; i < fit; i++) budgets.take("s:t1", command(`c${i}`));

    expect(patchOf(budgets.take("s:t1", command("again")))?.truncated).toBe(false);
    expect(patchOf(budgets.take("s:t1", command("over")))).toEqual({
      diff: "",
      added: 1000,
      removed: 0,
      truncated: true,
    });
  });
});
