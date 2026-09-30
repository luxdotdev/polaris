/**
 * Times Codex reasoning items: an item is live from `item/started`, and its
 * completion carries when it started and ended, as Codex stamped them (or as
 * the driver saw them, from a Codex that doesn't stamp them).
 */
import { TurnItem } from "@polaris/protocol";

export class ReasoningTimes {
  private readonly started = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  private at(ms: number | undefined): string {
    return new Date(ms !== undefined && ms > 0 ? ms : this.now()).toISOString();
  }

  /** A reasoning item began: its live progress, empty until its deltas arrive. */
  start(id: string, atMs: number | undefined): TurnItem {
    const startedAt = this.at(atMs);
    this.started.set(id, startedAt);

    return TurnItem.cases.Reasoning.make({ id, text: "", startedAt, endedAt: null });
  }

  /** A completed item, with its times when it is reasoning Polaris saw start. */
  finish(item: TurnItem, atMs: number | undefined): TurnItem {
    if (!TurnItem.guards.Reasoning(item)) return item;
    const startedAt = this.started.get(item.id);

    if (startedAt === undefined) return item;
    this.started.delete(item.id);

    return TurnItem.cases.Reasoning.make({ ...item, startedAt, endedAt: this.at(atMs) });
  }
}
