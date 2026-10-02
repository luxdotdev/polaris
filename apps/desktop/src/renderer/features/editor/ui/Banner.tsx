/**
 * The strip above the code when the file needs a decision (spec §3):
 * "Changed on disk by {agent} · Compare · Keep mine · Take theirs", a deleted
 * file, a failed save, or a Daemon that can't save. Neutral: it is no signal.
 */
import { Button } from "@polaris/ui";
import type { Banner as BannerModel, BannerAction } from "../model/banner.ts";

export interface BannerProps {
  readonly banner: BannerModel;
  /** Compare is a toggle: it reads "Back to editing" while comparing. */
  readonly comparing: boolean;
  readonly onAction: (action: BannerAction) => void;
}

export const Banner = ({ banner, comparing, onAction }: BannerProps) => (
  <div
    role={banner.kind === "conflict" ? "alert" : "status"}
    data-testid="editor-banner"
    data-kind={banner.kind}
    className="border-hairline bg-surface-sunken flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 pr-3 pl-5"
  >
    <span className="text-body text-text-default min-w-0 flex-1">{banner.text}</span>
    <span className="flex shrink-0 items-center gap-1.5">
      {banner.actions.map(({ action, label }) => (
        <Button
          key={action}
          variant={action === "compare" ? "ghost" : "secondary"}
          aria-pressed={action === "compare" ? comparing : undefined}
          onClick={() => onAction(action)}
        >
          {action === "compare" && comparing ? "Back to editing" : label}
        </Button>
      ))}
    </span>
  </div>
);
