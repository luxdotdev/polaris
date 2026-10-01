/**
 * The Overview tab (Paper R9 AK9-0, B4G-0, CS2-0, D6Z-0). A pull request: the description,
 * the pinned bot summary, the walkthrough, then a line to Conversation; on re-review "New
 * since your last review" leads and the rest folds. An Agent Session: its prompts, then the
 * walkthrough.
 */
import { type ReactNode, useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import type { PullDetailView } from "../../../../../shared/github.ts";
import { type Staleness, stalenessOf } from "../model/botSummary.ts";
import { ago, count } from "../model/copy.ts";
import { publishedBody, publishOffer } from "../model/publish.ts";
import { commentCount } from "../model/tabs.ts";
import { authorOf, newSince } from "../model/timeline.ts";
import type { PullOverviewView, TimelineItemView, WalkthroughView } from "../model/types.ts";
import type { Walkthroughs } from "../data/overview.ts";
import { BotSummaryCard } from "./BotSummary.tsx";
import { Timeline } from "./Conversation.tsx";
import { Description } from "./Description.tsx";
import { Prompts } from "./Prompts.tsx";
import { PublishButton } from "./Publish.tsx";
import { type WalkthroughActions, WalkthroughCard } from "./Walkthrough.tsx";
import { useStore } from "zustand";
import { surfaceStore } from "../../surface.ts";

interface Common extends WalkthroughActions {
  readonly subjectKey: string;
  readonly walkthroughs: Walkthroughs;
  readonly paths: ReadonlyArray<string>;
  readonly now: number;
  readonly onConversation: () => void;
}

export interface PullOverviewProps extends Common {
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly detail: PullDetailView;
  readonly overview: PullOverviewView;
}

const REVIEWED = {
  approved: "approved",
  "changes-requested": "requested changes",
  commented: "reviewed",
  dismissed: "reviewed",
} as const;

const describe = (item: TimelineItemView) => {
  const who = authorOf(item)?.login ?? "someone";

  if (item.kind === "review") return `${who} ${REVIEWED[item.state]}`;

  if (item.kind === "push") return `${who} pushed`;

  return `${who} commented`;
};

/** "12 comments · suzuka on 2 lines · latest: arossi approved 1 hour ago". */
const conversationLine = (overview: PullOverviewView, now: number) => {
  const { timeline } = overview;
  const botLines = new Map<string, number>();

  for (const item of timeline) {
    const author = authorOf(item);

    if (item.kind === "thread" && author?.bot === true) {
      botLines.set(author.login, (botLines.get(author.login) ?? 0) + 1);
    }
  }

  const latest = [...timeline].reverse().find((i) => i.kind !== "push");

  return [
    count(commentCount(timeline), "comment"),
    ...[...botLines].map(([bot, n]) => `${bot} on ${count(n, "line")}`),
    latest === undefined ? null : `latest: ${describe(latest)} ${ago(latest.at, now)}`,
  ]
    .filter((p) => p !== null)
    .join(" · ");
};

const ToConversation = ({
  line,
  onOpen,
}: {
  readonly line: string;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    onClick={onOpen}
    data-testid="to-conversation"
    className="rounded-row border-hairline bg-surface-raised gap-gap hover:bg-fill-hover flex h-9 cursor-default items-center border px-3.5 text-left"
  >
    <span className="text-body text-text-strong font-medium">Conversation</span>
    <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{line}</span>
    <span className="text-caption text-text-default font-medium">Open →</span>
  </button>
);

/** One line standing in for a card on re-review; opens it in place. */
const Folded = ({
  title,
  preview,
  children,
  testId,
  open,
  onOpen,
}: {
  readonly title: string;
  readonly preview: string;
  readonly children: ReactNode;
  readonly testId: string;
  readonly open: boolean;
  readonly onOpen: () => void;
}) => {
  if (open) return <div id={testId}>{children}</div>;

  return (
    <button
      type="button"
      id={testId}
      data-testid={testId}
      onClick={onOpen}
      className="rounded-row border-hairline gap-gap hover:bg-fill-hover flex h-9 cursor-default items-center border px-3.5 text-left"
    >
      <span className="text-body text-text-strong shrink-0 font-medium">{title}</span>
      <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{preview}</span>
      <span className="text-caption text-text-default font-medium">Show</span>
    </button>
  );
};

const Label = ({
  children,
  trailing,
}: {
  readonly children: string;
  readonly trailing?: string;
}) => (
  <div className="gap-gap flex items-baseline pt-1">
    <span className="text-caption text-text-default font-medium">{children}</span>
    {trailing !== undefined && <span className="text-caption text-text-subtle">{trailing}</span>}
  </div>
);

const newLine = (items: ReadonlyArray<TimelineItemView>) => {
  const pushes = items
    .filter((i) => i.kind === "push")
    .reduce((n, i) => n + (i.kind === "push" ? i.commits.length : 0), 0);

  const approvals = items.filter((i) => i.kind === "review" && i.state === "approved").length;

  const replies = items.filter(
    (i) => i.kind === "comment" || (i.kind === "review" && i.state !== "approved")
  ).length;

  return [
    pushes === 0 ? null : count(pushes, "commit"),
    approvals === 0 ? null : count(approvals, "approval"),
    replies === 0 ? null : count(replies, "reply", "replies"),
  ]
    .filter((p) => p !== null)
    .join(" · ");
};

const firstLine = (markdown: string) =>
  markdown
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find((l) => l !== "") ?? "";

export const PullOverview = (props: PullOverviewProps) => {
  const { subjectKey, pull, detail, overview, walkthroughs, paths, now } = props;
  const head = detail.headRefOid;
  const own = detail.author?.login === detail.viewerLogin;
  const findings = useStore(surfaceStore, (s) => s[subjectKey]?.findings ?? []);
  const lastReview = overview.viewerLastReview;
  const fresh = newSince(overview.timeline, lastReview?.at ?? null);

  const rereview =
    lastReview !== null &&
    (fresh.length > 0 || (lastReview.commitOid !== null && lastReview.commitOid !== head));

  const staleness: Staleness =
    overview.botSummary === null
      ? { kind: "current" }
      : stalenessOf(overview.botSummary, head, overview.commits);

  const full = walkthroughs.full;
  const offer = full?.state === "ready" ? publishOffer(own, overview.published, head) : null;
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const open = (id: string) => setOpened(new Set([...opened, id]));

  const showFull = () => {
    open("folded-walkthrough");

    requestAnimationFrame(() =>
      document.getElementById("folded-walkthrough")?.scrollIntoView({ block: "start" })
    );
  };

  const walkthrough = (w: WalkthroughView, delta: boolean) => (
    <WalkthroughCard
      {...props}
      walkthrough={w}
      scope={`of ${w.head.slice(0, 7)}`}
      delta={delta ? { onFull: showFull } : null}
      trailing={
        offer === null || delta ? null : (
          <PublishButton
            offer={offer}
            pull={pull}
            pullId={detail.id}
            viewer={detail.viewerLogin}
            head={head}
            current={overview.body}
            body={publishedBody(
              w.markdown,
              findings.map((f) => ({ id: f.id, path: f.path, line: f.lines.end })),
              [w.harness, w.model].filter((p) => p !== null).join(" · ")
            )}
          />
        )
      }
    />
  );

  const summary =
    overview.botSummary === null ? null : (
      <BotSummaryCard
        subjectKey={subjectKey}
        pull={pull}
        summary={overview.botSummary}
        staleness={staleness}
        head={head}
        viewer={detail.viewerLogin}
        paths={paths}
        now={now}
      />
    );

  const description = (
    <Description
      subjectKey={subjectKey}
      author={
        detail.author === null
          ? null
          : { login: detail.author.login, bot: detail.author.bot ?? false }
      }
      body={overview.body}
      own={own}
      url={detail.url}
      paths={paths}
    />
  );

  if (rereview) {
    return (
      <div className="flex flex-col gap-3" data-testid="overview" data-rereview="">
        <Label trailing={newLine(fresh)}>New since your last review</Label>
        {walkthroughs.delta !== null && walkthrough(walkthroughs.delta, true)}
        <Timeline items={fresh} divideAt={null} subjectKey={subjectKey} paths={paths} now={now} />
        {summary}
        <Label>Before your review</Label>
        <Folded
          testId="folded-description"
          open={opened.has("folded-description")}
          onOpen={() => open("folded-description")}
          title="Description"
          preview={firstLine(overview.body) || "No description"}
        >
          {description}
        </Folded>
        {full !== null && full.state !== "off" && (
          <Folded
            testId="folded-walkthrough"
            open={opened.has("folded-walkthrough")}
            onOpen={() => open("folded-walkthrough")}
            title="Walkthrough"
            preview={firstLine(full.markdown.replace(/^#+.*$/m, ""))}
          >
            {walkthrough(full, false)}
          </Folded>
        )}
        <ToConversation line={conversationLine(overview, now)} onOpen={props.onConversation} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="overview">
      {description}
      {summary}
      {full !== null && walkthrough(full, false)}
      <ToConversation line={conversationLine(overview, now)} onOpen={props.onConversation} />
    </div>
  );
};

export interface SessionOverviewProps extends Common {
  readonly where: string;
  /** "turns 22–24". */
  readonly scope: string;
  readonly onOpenSession: () => void;
}

export const SessionOverview = (props: SessionOverviewProps) => {
  const { walkthroughs } = props;

  return (
    <div className="flex flex-col gap-3" data-testid="overview">
      {walkthroughs.prompts.length > 0 && (
        <Prompts
          prompts={walkthroughs.prompts}
          where={props.where}
          onOpenSession={props.onOpenSession}
        />
      )}
      {walkthroughs.full !== null && (
        <WalkthroughCard
          {...props}
          walkthrough={walkthroughs.full}
          scope={props.scope}
          delta={null}
        />
      )}
      {walkthroughs.prompts.length === 0 && walkthroughs.full === null && (
        <p className="text-caption text-text-subtle py-6 text-center">
          The walkthrough appears here once the reviewer has read these turns
        </p>
      )}
    </div>
  );
};
