/**
 * The strip above the code when the file needs a decision (spec §3):
 * "Changed on disk by {agent} · Compare · Keep mine · Take theirs", a deleted
 * file, a failed save, or a Daemon that can't save. Neutral: it is no signal.
 */
import { Button } from "@polaris/ui";
import type { ReactNode } from "react";
import type { Banner as BannerModel, BannerAction } from "../model/banner.ts";

export interface BannerProps {
  readonly banner: BannerModel;
  /** Compare is a toggle: it reads "Back to editing" while comparing. */
  readonly comparing: boolean;
  readonly onAction: (action: BannerAction) => void;
}

/** The neutral strip under the breadcrumbs: one sentence, then its actions. */
export const EditorStrip = ({
  role,
  testId,
  kind,
  text,
  children,
}: {
  readonly role: "alert" | "status";
  readonly testId: string;
  readonly kind: string;
  readonly text: string;
  readonly children: ReactNode;
}) => (
  <div
    role={role}
    data-testid={testId}
    data-kind={kind}
    className="border-hairline bg-surface-sunken flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 pr-3 pl-5"
  >
    <span className="text-body text-text-default min-w-0 flex-1">{text}</span>
    <span className="flex shrink-0 items-center gap-1.5">{children}</span>
  </div>
);

export const Banner = ({ banner, comparing, onAction }: BannerProps) => (
  <EditorStrip
    role={banner.kind === "conflict" ? "alert" : "status"}
    testId="editor-banner"
    kind={banner.kind}
    text={banner.text}
  >
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
  </EditorStrip>
);
