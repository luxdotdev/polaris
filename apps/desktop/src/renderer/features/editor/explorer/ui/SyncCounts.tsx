/** ↓behind ↑ahead and the sync glyph, shared by the changes tab and the status bar. */
import { ArrowDownIcon, ArrowUpIcon, CloudUploadIcon, SyncIcon } from "@polaris/ui";
import type { SyncStanding } from "../model/sync.ts";

export const SyncCounts = ({
  ahead,
  behind,
}: {
  readonly ahead: number;
  readonly behind: number;
}) =>
  ahead === 0 && behind === 0 ? null : (
    <span
      className="text-caption text-text-subtle flex shrink-0 items-center gap-1.5 tabular-nums"
      data-testid="sync-counts"
      aria-label={`${behind} to pull, ${ahead} to push`}
    >
      {behind > 0 ? <span>↓{behind}</span> : null}
      {ahead > 0 ? <span>↑{ahead}</span> : null}
    </span>
  );

/** Down to pull, up to push, both ways to sync, a cloud to publish. */
export const SyncGlyph = ({
  standing,
  size,
}: {
  readonly standing: SyncStanding;
  readonly size: number;
}) => {
  if (standing === "behind") return <ArrowDownIcon size={size} className="shrink-0" />;

  if (standing === "ahead") return <ArrowUpIcon size={size} className="shrink-0" />;

  if (standing === "unpublished") return <CloudUploadIcon size={size} className="shrink-0" />;

  return <SyncIcon size={size} className="shrink-0" />;
};
