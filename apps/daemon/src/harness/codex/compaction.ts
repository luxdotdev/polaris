/**
 * Compaction on Codex, as a `ContextUsed` report. Codex runs it as a `contextCompaction` item
 * and reports the window's new size (`thread/tokenUsage/updated`) between the item's start and
 * end; `/compact` (`thread/compact/start`) asks for one, and Codex compacts on its own when full.
 */
import { HarnessEvent } from "../HarnessDriver.ts";

interface Usage {
  readonly used: number;
  readonly window: number | null;
}

export class CodexCompaction {
  private usage: Usage | null = null;
  /** The window when the item started, and what Codex reported since. */
  private running: { readonly before: number | null; readonly manual: boolean } | null = null;
  private after: Usage | null = null;
  private requested = false;

  /** `thread/compact/start` is on its way (or failed: `requested(false)`). */
  request(requested: boolean) {
    this.requested = requested;
  }

  usageReported(used: number, window: number | null) {
    this.usage = { used, window };

    if (this.running !== null) this.after = this.usage;
  }

  started() {
    this.running = { before: this.usage?.used ?? null, manual: this.requested };
    this.after = null;
  }

  /** The report for a finished compaction; null while Codex has said nothing of the window. */
  completed() {
    const { running, after, usage } = this;
    this.running = null;
    this.after = null;
    this.requested = false;
    const now = after ?? usage;

    if (now === null) return null;

    return HarnessEvent.ContextUsed({
      usedTokens: now.used,
      windowTokens: now.window,
      compacted: {
        trigger: running?.manual === true ? "manual" : "auto",
        beforeTokens: running?.before ?? null,
        afterTokens: after?.used ?? null,
      },
    });
  }
}
