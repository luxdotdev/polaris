/**
 * The two columns under the subject header (Paper R1 1VR-0): the risk column (the Risk
 * Summary slot, the file list, its foot slot) and the diff, or what stands in for the diff
 * while it loads, fails or waits for a Review Checkout.
 */
import { EmptyState, PixelForkIcon } from "@polaris/ui";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { type ReactNode, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { ReviewDiff } from "../data/useReviewDiff.ts";
import { paneState } from "../model/paneState.ts";
import { scaleNotice } from "../model/policy.ts";
import { quoteLines } from "../model/quote.ts";
import {
  type DiffSelection,
  emptySurface,
  type ReviewSlotProps,
  reviewSlots,
  surfaceStore,
  updateSurface,
} from "../surface.ts";
import {
  type EditorPlace,
  EditorPlaceProvider,
  usePublishReviewPlace,
} from "../../editor-links/index.ts";
import { CentrePane, setTab, type SessionInfo } from "../overview/index.ts";
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
  /** An Agent Session's Overview; null for a pull request. */
  readonly session: SessionInfo | null;
  /** The checkout's merge base, for narrowing Changes to the first commit. */
  readonly mergeBase: string | null;
  /** Where the diff's paths are on disk (the Review Checkout, the session's cwd), for "Open in editor". */
  readonly place: EditorPlace | null;
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

const selectionOf = (
  path: string,
  range: SelectedLineRange,
  item: { readonly fileDiff: FileDiffMetadata } | null,
  turn: number | null
): DiffSelection => {
  const side = range.side === "deletions" ? "old" : "new";
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const code = item === null ? "" : quoteLines(item.fileDiff, side, start, end);

  return { path, side, start, end, code, turn };
};

const Waiting = ({ placeholder }: { readonly placeholder: Placeholder | null }) => (
  <div
    className="bg-bg flex min-w-0 flex-1 items-center justify-center"
    data-testid="review-waiting"
  >
    {placeholder === null ? (
      <span className="text-caption text-text-subtle">Reading the diff…</span>
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
  session,
  mergeBase,
}: ReviewBodyProps & { readonly diff: Extract<ReviewDiff, { readonly kind: "ready" }> }) => {
  const surface = useStore(surfaceStore, (s) => s[subjectKey] ?? emptySurface);
  const themeType = useThemeType();

  const model = useReviewModel({
    subjectKey,
    diff,
    findings: surface.findings,
    annotations: surface.annotations,
    selection: surface.selection,
    pullViewed,
  });

  const pane = paneState({
    files: model.files.length,
    items: model.items.length,
    complete: diff.complete,
    scale: diff.scale,
  });

  const paths = useMemo(() => model.files.map((f) => f.file.path), [model.files]);

  useEffect(() => updateSurface(subjectKey, { paths }), [subjectKey, paths]);

  useEffect(() => {
    const diffs = new Map(
      model.items.flatMap((p) =>
        p.item.type === "diff" ? [[p.path, p.item.fileDiff] as const] : []
      )
    );

    updateSurface(subjectKey, {
      quote: (range) => {
        const fileDiff = diffs.get(range.path);

        return fileDiff === undefined
          ? ""
          : quoteLines(fileDiff, range.side, range.start, range.end);
      },
    });
  }, [subjectKey, model.items]);

  return (
    <div className="flex min-h-0 flex-1">
      <RiskColumn slotProps={slotProps}>
        <FileList
          files={model.files}
          viewedOf={model.viewedOf}
          changedOf={(file) => model.viewedStateOf(file) === "changed"}
          severities={model.severities}
          progress={model.progress}
          current={model.openFile}
          notice={scaleNotice(diff.scale, model.files.length)}
          onOpen={(file) => {
            setTab(subjectKey, "changes");
            model.open(file);
          }}
          onViewed={model.setViewed}
        />
      </RiskColumn>
      <CentrePane
        subjectKey={subjectKey}
        slotProps={slotProps}
        files={model.files.length}
        viewed={model.progress.viewed}
        session={session}
        mergeBase={mergeBase}
        changes={
          <div
            className="bg-bg flex min-h-0 min-w-0 flex-1 flex-col"
            data-testid="review-diff"
            data-complete={diff.complete ? "" : undefined}
            data-files={model.files.length}
          >
            {pane.kind === "message" ? (
              <Waiting placeholder={{ title: pane.title, fact: pane.fact }} />
            ) : (
              <DiffPane
                items={model.items}
                marksCss={model.marksCss}
                themeType={themeType}
                loadDiffFiles={model.loadDiffFiles}
                itemKeys={model.itemKeys}
                onSelect={(id, range) => {
                  const file = model.files.find((f) => f.key === id);
                  const parsed = model.items.find((p) => p.item.id === id)?.item;

                  updateSurface(subjectKey, {
                    selection:
                      file === undefined || range === null
                        ? null
                        : selectionOf(
                            file.file.path,
                            range,
                            parsed?.type === "diff" ? parsed : null,
                            diff.sections.find((s) => s.id === file.section)?.divider?.turn ?? null
                          ),
                  });
                }}
              />
            )}
          </div>
        }
      />
    </div>
  );
};

const Body = (props: ReviewBodyProps) => {
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
      <CentrePane
        subjectKey={props.subjectKey}
        slotProps={props.slotProps}
        files={null}
        viewed={null}
        session={props.session}
        mergeBase={props.mergeBase}
        changes={<Waiting placeholder={props.placeholder ?? failed} />}
      />
    </div>
  );
};

export const ReviewBody = (props: ReviewBodyProps) => {
  usePublishReviewPlace(props.place);

  return (
    <EditorPlaceProvider value={props.place}>
      <Body {...props} />
    </EditorPlaceProvider>
  );
};
