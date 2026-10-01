/**
 * The two columns under the subject header (Paper R1 1VR-0): the risk column (the Risk
 * Summary slot, the file list, its foot slot) and the diff, or what stands in for the diff
 * while it loads, fails or waits for a Review Checkout.
 */
import { EmptyState, PixelForkIcon } from "@polaris/ui";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { ReviewDiff } from "../data/useReviewDiff.ts";
import { scaleNotice } from "../model/policy.ts";
import {
  emptySurface,
  type ReviewSlotProps,
  reviewSlots,
  surfaceStore,
  updateSurface,
} from "../surface.ts";
import { DiffPane } from "./DiffPane.tsx";
import { FileList } from "./FileList.tsx";
import { useThemeType } from "./theme.ts";
import { type PullViewed, useReviewModel } from "./useReviewModel.ts";

export interface Placeholder {
  readonly title: string;
  readonly fact: string;
  readonly action?: ReactNode;
}

export interface ReviewBodyProps {
  readonly subjectKey: string;
  readonly slotProps: ReviewSlotProps;
  readonly diff: ReviewDiff;
  readonly pullViewed: PullViewed | null;
  /** Shown instead of the diff (no checkout yet, a failure); null while loading or ready. */
  readonly placeholder: Placeholder | null;
}

const RiskColumn = ({
  slotProps,
  children,
}: {
  readonly slotProps: ReviewSlotProps;
  readonly children: ReactNode;
}) => {
  const { RiskColumn: Risk, RiskFooter: Footer } = reviewSlots.current;

  return (
    <aside
      data-testid="risk-column"
      className="border-hairline flex w-[360px] shrink-0 flex-col border-r"
    >
      <Risk {...slotProps} />
      {children}
      <Footer {...slotProps} />
    </aside>
  );
};

const Waiting = ({ placeholder }: { readonly placeholder: Placeholder | null }) => (
  <div
    className="bg-bg flex min-w-0 flex-1 items-center justify-center"
    data-testid="review-waiting"
  >
    {placeholder === null ? (
      <span className="text-caption text-text-faint">Reading the diff…</span>
    ) : (
      <EmptyState icon={<PixelForkIcon size={24} />} {...placeholder} />
    )}
  </div>
);

const Ready = ({
  subjectKey,
  slotProps,
  diff,
  pullViewed,
}: ReviewBodyProps & { readonly diff: Extract<ReviewDiff, { readonly kind: "ready" }> }) => {
  const surface = useStore(surfaceStore, (s) => s[subjectKey] ?? emptySurface);
  const themeType = useThemeType();

  const model = useReviewModel({
    subjectKey,
    diff,
    findings: surface.findings,
    annotations: surface.annotations,
    pullViewed,
  });

  return (
    <div className="flex min-h-0 flex-1">
      <RiskColumn slotProps={slotProps}>
        <FileList
          files={model.files}
          viewedOf={model.viewedOf}
          severities={model.severities}
          progress={model.progress}
          current={model.openFile}
          notice={scaleNotice(diff.scale, model.files.length)}
          onOpen={model.open}
          onViewed={model.setViewed}
        />
      </RiskColumn>
      <div className="bg-bg flex min-w-0 flex-1 flex-col" data-testid="review-diff">
        {model.items.length === 0 && diff.complete ? (
          <Waiting
            placeholder={
              model.files.length === 0
                ? { title: "No changes", fact: "Nothing differs between these revisions" }
                : { title: "Pick a file", fact: "Open a file from the list to see its diff" }
            }
          />
        ) : (
          <DiffPane
            items={model.items}
            marksCss={model.marksCss}
            themeType={themeType}
            loadDiffFiles={model.loadDiffFiles}
            itemKeys={model.itemKeys}
            onSelect={(id, range) => {
              const file = model.files.find((f) => f.key === id);

              updateSurface(subjectKey, {
                selection:
                  file === undefined || range === null
                    ? null
                    : {
                        path: file.file.path,
                        side: range.side === "deletions" ? "old" : "new",
                        start: Math.min(range.start, range.end),
                        end: Math.max(range.start, range.end),
                      },
              });
            }}
          />
        )}
      </div>
    </div>
  );
};

export const ReviewBody = (props: ReviewBodyProps) => {
  if (props.diff.kind === "ready") return <Ready {...props} diff={props.diff} />;

  const failed: Placeholder | null =
    props.diff.kind === "failed"
      ? { title: "Couldn’t read the diff", fact: props.diff.error.message }
      : null;

  return (
    <div className="flex min-h-0 flex-1">
      <RiskColumn slotProps={props.slotProps}>
        <div className="flex-1" />
      </RiskColumn>
      <Waiting placeholder={props.placeholder ?? failed} />
    </div>
  );
};
