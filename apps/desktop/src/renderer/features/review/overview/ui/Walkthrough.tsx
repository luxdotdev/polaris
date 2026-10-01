/**
 * The walkthrough card (Paper R9 CM4-0, CQ9-0): Polaris's read-only account of the change,
 * written by its own session beside the Reviewer. Writing, waiting to ask first, ready,
 * and failed; a delta one on re-review covers only the new commits.
 */
import { Button, harnessHue } from "@polaris/ui";
import type { ReactNode } from "react";
import { count, duration, tokens } from "../model/copy.ts";
import type { WalkthroughView } from "../model/types.ts";
import { shortSha } from "../model/botSummary.ts";
import { ReviewMarkdown } from "./markdown/index.tsx";
import { reviewLinks } from "./links.tsx";
import { Card, CardHead, PolarisMark, TextAction } from "./parts.tsx";

export interface WalkthroughActions {
  /** "Run both": the Reviewer and the walkthrough, past "Ask first". */
  readonly onRun: (() => void) | null;
  readonly onNotNow: (() => void) | null;
  readonly onStop: (() => void) | null;
  readonly onRetry: (() => void) | null;
  readonly onOtherHost: (() => void) | null;
  readonly onReviewChanges: () => void;
}

export interface WalkthroughProps extends WalkthroughActions {
  readonly subjectKey: string;
  readonly walkthrough: WalkthroughView;
  readonly paths: ReadonlyArray<string>;
  /** "of 7be3d1" for a pull request, "turns 22–24" for an Agent Session. */
  readonly scope: string;
  /** Trailing actions in the head of a ready one ("Publish as description", the menu). */
  readonly trailing?: ReactNode;
  /** A delta walkthrough's title and its link to the full one. */
  readonly delta?: { readonly onFull: () => void } | null;
}

const who = (w: WalkthroughView) =>
  [w.harness === null ? null : harnessHue(w.harness).name, w.model, w.effort]
    .filter((p) => p !== null)
    .join(" · ");

const SECTIONS = ["Why the change", "Special things to note", "Change outline"] as const;

/** Placeholder lines for the sections a writing walkthrough hasn't reached yet. */
const Pending = ({ markdown }: { readonly markdown: string }) => (
  <>
    {SECTIONS.flatMap((section) => (markdown.includes(section) ? [] : [section])).map((section) => (
      <div key={section} className="flex flex-col gap-2" data-testid="walkthrough-pending">
        <span className="text-caption text-text-subtle font-medium">{section}</span>
        {section !== "Change outline" ? (
          <>
            <span className="bg-fill-selected h-2 w-4/5 rounded-full" />
            <span className="bg-fill-selected h-2 w-3/5 rounded-full" />
            <span className="bg-fill-selected h-2 w-2/3 rounded-full" />
          </>
        ) : (
          <span className="bg-surface-sunken rounded-row h-[72px]" />
        )}
      </div>
    ))}
  </>
);

const Body = ({
  subjectKey,
  markdown,
  paths,
}: {
  readonly subjectKey: string;
  readonly markdown: string;
  readonly paths: ReadonlyArray<string>;
}) =>
  markdown.trim() === "" ? null : (
    <div className="walkthrough-md">
      <ReviewMarkdown markdown={markdown} paths={paths} renderLink={reviewLinks(subjectKey)} />
    </div>
  );

/** Over "Ask first for large changes": one choice runs the Reviewer and the walkthrough. */
const Waiting = ({ walkthrough: w, onRun, onNotNow }: WalkthroughProps) => (
  <Card data-testid="walkthrough" data-state="waiting">
    <div className="gap-gap pr-row-pad py-row-pad flex items-center pl-3.5">
      <PolarisMark />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-text-strong font-medium">
          Write a walkthrough of {count(w.lines, "changed line")}?
        </span>
        <span className="text-caption text-text-subtle">
          {[
            w.tokensEstimate === null ? null : `About ${tokens(w.tokensEstimate).slice(1)}`,
            who(w) === "" ? null : `on ${who(w)}`,
          ]
            .filter((p) => p !== null)
            .join(" ")}
          . The reviewer waits on the same choice.
        </span>
      </div>
      {onNotNow !== null && (
        <Button variant="ghost" size="sm" onClick={onNotNow}>
          Not now
        </Button>
      )}
      {onRun !== null && (
        <Button variant="primary" size="sm" onClick={onRun} data-testid="walkthrough-run">
          Run both
        </Button>
      )}
    </div>
  </Card>
);

const Failed = ({ walkthrough: w, onRetry, onOtherHost }: WalkthroughProps) => (
  <Card data-testid="walkthrough" data-state="failed">
    <div className="gap-gap pr-row-pad py-row-pad flex items-start pl-3.5">
      <PolarisMark />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="gap-gap flex items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-failed-text font-medium">
              Couldn’t write the walkthrough
            </span>
            {w.reason !== null && <span className="text-caption text-text-subtle">{w.reason}</span>}
          </div>
          {onOtherHost !== null && (
            <Button variant="ghost" size="sm" onClick={onOtherHost}>
              Use another host
            </Button>
          )}
          {onRetry !== null && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
        {w.evidence !== null && (
          <code className="bg-surface-sunken rounded-control text-code-inline text-text-default px-2.5 py-1.5 font-mono break-all">
            {w.evidence}
          </code>
        )}
      </div>
    </div>
  </Card>
);

const headLine = (w: WalkthroughView, scope: string) => {
  if (w.state === "writing") {
    const read = w.filesTotal > 0 ? `read ${w.filesRead} of ${count(w.filesTotal, "file")}` : null;

    return [`${who(w).split(" · ")[0] ?? "It"} is writing it`, read].filter(Boolean).join(" · ");
  }

  return [`by ${who(w)}`, scope, w.durationMs === null ? null : duration(w.durationMs)]
    .filter((p) => p !== null && p !== "")
    .join(" · ");
};

const Written = (props: WalkthroughProps) => {
  const { walkthrough: w, subjectKey, paths, scope, trailing, delta, onStop } = props;
  const writing = w.state === "writing";

  return (
    <Card data-testid="walkthrough" data-state={w.state} data-delta={delta ? "" : undefined}>
      <CardHead ruled>
        <PolarisMark />
        <span className="text-body text-text-strong shrink-0 font-medium">
          {delta ? "Walkthrough · what the new commits change" : "Walkthrough"}
        </span>
        <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
          {delta && w.fromHead !== null
            ? `${shortSha(w.fromHead)} → ${shortSha(w.head)} · ${who(w).split(" · ")[0] ?? ""}`
            : headLine(w, scope)}
        </span>
        {writing && onStop !== null && (
          <TextAction strong onClick={onStop}>
            Stop
          </TextAction>
        )}
        {!writing && delta && <TextAction onClick={delta.onFull}>Full walkthrough</TextAction>}
        {!writing && !delta && <span className="text-caption text-text-subtle">Read-only</span>}
        {!writing && trailing}
      </CardHead>
      <div className="px-panel flex flex-col gap-4 py-3.5">
        <Body subjectKey={subjectKey} markdown={w.markdown} paths={paths} />
        {writing && <Pending markdown={w.markdown} />}
      </div>
      {!writing && !delta && (
        <div className="border-hairline gap-gap px-panel flex h-10 items-center border-t">
          <span className="text-caption text-text-subtle flex-1 truncate">
            {[
              "Paths open in Changes",
              w.tokens === null ? null : tokens(w.tokens),
              "rewritten only when the head moves",
            ]
              .filter((p) => p !== null)
              .join(" · ")}
          </span>
          <TextAction strong onClick={props.onReviewChanges}>
            Review changes →
          </TextAction>
        </div>
      )}
    </Card>
  );
};

export const WalkthroughCard = (props: WalkthroughProps) => {
  const { state } = props.walkthrough;

  if (state === "off") return null;

  if (state === "waiting") return <Waiting {...props} />;

  return state === "failed" ? <Failed {...props} /> : <Written {...props} />;
};
