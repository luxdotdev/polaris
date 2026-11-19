/**
 * How much patch text a Turn stores (ENG-979). A completed item is written to the event log and
 * to `turn_items`, so a Turn's patches past `TURN_PATCH_BUDGET` keep their counts only.
 */
import { countsOnlyPatch, TurnItem } from "@polaris/protocol";

/** Patch text one Turn stores across its `FileChange` items, in characters (2 MiB). */
export const TURN_PATCH_BUDGET = 2 * 1024 * 1024;

export class TurnPatchBudgets {
  private readonly used = new Map<string, number>();

  /** `item`, its patches past the Turn's budget cut to counts; what it keeps is spent. */
  take(turn: string, item: TurnItem): TurnItem {
    if (!TurnItem.guards.FileChange(item)) return item;
    let used = this.used.get(turn) ?? 0;
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

    this.used.set(turn, used);

    return cut ? TurnItem.cases.FileChange.make({ ...item, changes }) : item;
  }

  /** The Turn ended: its budget goes. */
  end(turn: string): void {
    this.used.delete(turn);
  }
}
