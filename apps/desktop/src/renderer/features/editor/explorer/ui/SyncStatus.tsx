/**
 * The status bar's sync item (DESIGN.md, Editor → Sync with the remote): the
 * glyph and ↓behind ↑ahead, one click runs the changes tab's sync button. A
 * running sync shows what it's doing; a failed one says so and opens changes.
 */
import { cn } from "@polaris/ui";
import { SyncCounts, SyncGlyph } from "./SyncCounts.tsx";
import type { SyncControls } from "./useSync.ts";

const ITEM =
  "flex min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-[4px] px-1 -mx-1 hover:text-text-default disabled:hover:text-text-subtle";

export const SyncStatus = ({
  controls,
  counts = true,
}: {
  readonly controls: SyncControls;
  /** False when the status row dropped the counts for room: the glyph and its hint remain. */
  readonly counts?: boolean;
}) => {
  const { view } = controls;

  if (view.running !== null) {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5"
        data-testid="status-sync"
        data-state="running"
      >
        <SyncGlyph standing={view.standing} size={12} />
        <span className="truncate">{view.running.label}</span>
      </span>
    );
  }

  if (view.failure !== null) {
    return (
      <button
        type="button"
        className={cn(ITEM, "text-text-default")}
        title={view.failure.detail || view.failure.headline}
        onClick={controls.showChanges}
        data-testid="status-sync"
        data-state="failed"
      >
        <SyncGlyph standing={view.standing} size={12} />
        <span className="truncate">{view.failure.headline}</span>
      </button>
    );
  }

  const { primary } = view;

  if (primary === null) return null;

  return (
    <button
      type="button"
      className={ITEM}
      disabled={view.away !== null}
      title={view.away ?? primary.hint}
      aria-label={primary.hint}
      onClick={() => controls.run(primary.action)}
      data-testid="status-sync"
      data-state={view.standing}
    >
      <SyncGlyph standing={view.standing} size={12} />
      <span data-drop="sync-counts" hidden={!counts}>
        <SyncCounts ahead={view.ahead} behind={view.behind} />
      </span>
      {view.standing === "unpublished" ? <span>Publish</span> : null}
    </button>
  );
};
