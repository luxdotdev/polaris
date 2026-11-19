/**
 * How much patch text a Turn stores (ENG-979). A completed item is written to the event log and
 * to `turn_items`, so a Turn's patches past `TURN_PATCH_BUDGET` keep their counts only.
 */
import { countsOnlyPatch, TurnItem } from "@polaris/protocol";

/** Patch text one Turn stores across its `FileChange` items and its commands' changes, in characters (2 MiB). */
export const TURN_PATCH_BUDGET = 2 * 1024 * 1024;

type Patched = Extract<TurnItem, { readonly _tag: "FileChange" | "CommandExecution" }>;

/** `item` with `changes` in place of its own. */
const withChanges = (item: Patched, changes: NonNullable<Patched["changes"]>): TurnItem =>
  TurnItem.guards.FileChange(item)
    ? TurnItem.cases.FileChange.make({ ...item, changes })
    : TurnItem.cases.CommandExecution.make({ ...item, changes });

export class TurnPatchBudgets {
  /** What each item of a Turn spent: one that completes again spends anew, not twice. */
  private readonly used = new Map<string, Map<string, number>>();

  /** `item`, its patches past the Turn's budget cut to counts; what it keeps is spent. */
  take(turn: string, item: TurnItem): TurnItem {
    if (!TurnItem.guards.FileChange(item) && !TurnItem.guards.CommandExecution(item)) return item;

    if (item.changes === undefined) return item;
    const spent = this.used.get(turn) ?? new Map<string, number>();
    this.used.set(turn, spent);
    spent.delete(item.id);
    let used = 0;

    for (const size of spent.values()) used += size;
    const others = used;
    let cut = false;

    const changes = item.changes.map((change) => {
      const size = change.patch?.diff.length ?? 0;

      if (change.patch === undefined || size === 0) return change;

      if (used + size > TURN_PATCH_BUDGET) {
        cut = true;

        return { ...change, patch: countsOnlyPatch(change.patch.added, change.patch.removed) };
      }

      used += size;

      return change;
    });

    spent.set(item.id, used - others);

    return cut ? withChanges(item, changes) : item;
  }

  /** The Turn ended: its budget goes. */
  end(turn: string): void {
    this.used.delete(turn);
  }
}
