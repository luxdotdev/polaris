/**
 * One entry of the Conversation timeline (Paper R9 CBX-0): a push, a comment or review, a
 * run of inline threads as `file:line` snippets with "Open in changes", or a resolved
 * thread folded to one line. Long bot comments fold to their opening.
 */
import { cn, SeverityGlyph } from "@polaris/ui";
import { useState } from "react";
import { useStore } from "zustand";
import { surfaceStore } from "../../surface.ts";
import { ago, count } from "../model/copy.ts";
import {
  foldedBody,
  isLong,
  snippetOf,
  type ThreadItem,
  type TimelineEntry as Entry,
} from "../model/timeline.ts";
import type { PersonView, TimelineItemView } from "../model/types.ts";
import { ReviewMarkdown } from "./markdown/index.tsx";
import { openFinding, openPath, reviewLinks } from "./links.tsx";
import { BotTag, Card, CardHead, Mark, TextAction } from "./parts.tsx";
import { FileLink } from "../../../editor-links/index.ts";

export interface EntryProps {
  readonly subjectKey: string;
  readonly paths: ReadonlyArray<string>;
  readonly now: number;
}

const REVIEW_WORDS = {
  approved: { verb: "approved", pill: "Approved" },
  "changes-requested": { verb: "requested changes", pill: "Changes requested" },
  commented: { verb: "reviewed", pill: null },
  dismissed: { verb: "had a review dismissed", pill: "Dismissed" },
} as const;

const Who = ({ person }: { readonly person: PersonView | null }) => (
  <>
    <Mark person={person} />
    <span className="text-body text-text-strong font-medium">{person?.login ?? "ghost"}</span>
    {person?.bot === true && <BotTag />}
  </>
);

const Body = ({
  body,
  bot,
  subjectKey,
  paths,
}: EntryProps & { readonly body: string; readonly bot: boolean }) => {
  const long = bot && isLong(body);
  const [open, setOpen] = useState(!long);

  return (
    <div className="flex flex-col gap-1 pr-3.5 pb-3 pl-[42px]" data-folded={open ? undefined : ""}>
      <ReviewMarkdown
        markdown={open ? body : foldedBody(body)}
        paths={paths}
        renderLink={reviewLinks(subjectKey)}
      />
      {long && (
        <TextAction className="self-start" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </TextAction>
      )}
    </div>
  );
};

const Push = ({
  item,
  now,
}: {
  readonly item: Extract<TimelineItemView, { kind: "push" }>;
  readonly now: number;
}) => (
  <div
    className="text-caption text-text-subtle gap-gap flex items-center px-3.5"
    data-testid="timeline-push"
  >
    <span aria-hidden="true">⊸</span>
    <span className="min-w-0 truncate">
      {item.author?.login ?? "Someone"} {item.forced ? "force-pushed" : "pushed"}{" "}
      {count(item.commits.length, "commit")}
      {item.commits.length > 0 && item.commits.length <= 3
        ? ` · ${item.commits.map((c) => `“${c.headline}”`).join(", ")}`
        : ""}{" "}
      · {ago(item.at, now)}
    </span>
  </div>
);

const Said = (
  props: EntryProps & { readonly item: Extract<TimelineItemView, { kind: "comment" | "review" }> }
) => {
  const { item, now } = props;
  const review = item.kind === "review" ? REVIEW_WORDS[item.state] : null;

  if (review !== null && item.body.trim() === "") {
    return (
      <div
        className="text-caption text-text-subtle gap-gap flex items-center px-3.5"
        data-testid="timeline-review"
      >
        <Mark person={item.author} />
        <span>
          <span className="text-text-default font-medium">{item.author.login}</span> {review.verb} ·{" "}
          {ago(item.at, now)}
        </span>
      </div>
    );
  }

  return (
    <Card
      data-testid={item.kind === "review" ? "timeline-review" : "timeline-comment"}
      data-bot={item.author.bot ? "" : undefined}
    >
      <CardHead>
        <Who person={item.author} />
        <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
          {review?.verb ?? "commented"} · {ago(item.at, now)}
        </span>
        {review?.pill != null && (
          <span className="rounded-control border-hairline text-caption text-text-default border px-1.5">
            {review.pill}
          </span>
        )}
      </CardHead>
      <Body {...props} body={item.body} bot={item.author.bot} />
    </Card>
  );
};

/** A finding Polaris raised on the same lines, if any. */
const useSameFinding = (subjectKey: string, thread: ThreadItem) =>
  useStore(surfaceStore, (s) =>
    s[subjectKey]?.findings.find(
      (f) =>
        f.path === thread.path &&
        thread.line !== null &&
        f.lines.start <= thread.line &&
        thread.line <= f.lines.end
    )
  );

const SIGNS = { add: "+", del: "−", ctx: " " } as const;

const Snippet = ({ thread }: { readonly thread: ThreadItem }) => (
  <div className="bg-surface-sunken rounded-control text-code-inline overflow-x-auto py-1 font-mono">
    {snippetOf(thread.diffHunk).map((line, i) => (
      <div
        key={i}
        className={cn(
          "flex min-w-max px-2.5 whitespace-pre",
          line.kind === "add" && "bg-diff-added-bg",
          line.kind === "del" && "bg-diff-removed-bg"
        )}
      >
        <span className="text-text-subtle tabular w-8 shrink-0">{line.number}</span>
        <span className="text-text-subtle w-3 shrink-0">{SIGNS[line.kind]}</span>
        <span className="text-text-default">{line.text}</span>
      </div>
    ))}
  </div>
);

const Thread = (props: EntryProps & { readonly thread: ThreadItem }) => {
  const { thread, subjectKey } = props;
  const finding = useSameFinding(subjectKey, thread);
  const where = thread.line === null ? thread.path : `${thread.path}:${thread.line}`;

  return (
    <div
      className="border-hairline flex flex-col gap-2 border-t py-3 pr-3.5 pl-[42px]"
      data-testid="timeline-thread"
    >
      <div className="gap-gap flex items-center">
        <FileLink
          path={thread.path}
          line={thread.line}
          className="text-code-inline text-text-default font-mono"
        >
          {where}
        </FileLink>
        {thread.isOutdated && <span className="text-caption text-text-subtle">Outdated</span>}
        <span className="flex-1" />
        <TextAction
          strong
          onClick={() => openPath(thread.path, thread.line)}
          data-testid="thread-open-in-changes"
        >
          Open in changes
        </TextAction>
      </div>
      {thread.diffHunk !== "" && <Snippet thread={thread} />}
      {thread.comments.map((c) => (
        <div key={c.id} className="flex flex-col gap-1">
          {c !== thread.comments[0] && (
            <span className="text-caption text-text-subtle">
              <span className="text-text-default font-medium">{c.author.login}</span> ·{" "}
              {ago(c.at, props.now)}
            </span>
          )}
          <ReviewMarkdown
            markdown={c.body}
            paths={props.paths}
            renderLink={reviewLinks(subjectKey)}
          />
        </div>
      ))}
      {finding !== undefined && (
        <button
          type="button"
          onClick={() => openFinding(subjectKey, finding.id)}
          className="text-caption text-text-subtle hover:text-text-default flex cursor-default items-center gap-1.5 self-start"
        >
          <SeverityGlyph severity={finding.severity} tone="text" />
          Polaris found this too
        </button>
      )}
    </div>
  );
};

const Threads = (props: EntryProps & { readonly entry: Extract<Entry, { kind: "threads" }> }) => {
  const { entry, now } = props;
  const lines = entry.threads.length;

  return (
    <Card data-testid="timeline-threads">
      <CardHead>
        <Who person={entry.author} />
        <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
          commented on {count(lines, "line")} · {ago(entry.at, now)}
        </span>
      </CardHead>
      {entry.threads.map((thread) => (
        <Thread key={thread.id} {...props} thread={thread} />
      ))}
    </Card>
  );
};

const Resolved = (props: EntryProps & { readonly thread: ThreadItem }) => {
  const { thread, now } = props;
  const [open, setOpen] = useState(false);
  const where = thread.line === null ? thread.path : `${thread.path}:${thread.line}`;

  return (
    <div
      className="rounded-row border-hairline flex flex-col border"
      data-testid="timeline-resolved"
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-caption text-text-subtle gap-gap flex h-9 cursor-default items-center px-3.5 text-left"
      >
        <span
          aria-hidden="true"
          className={cn("transition-transform duration-120", open && "rotate-90")}
        >
          ›
        </span>
        <span className="text-text-default">Resolved</span>
        <span className="text-code-inline text-text-default font-mono">{where}</span>
        <span className="min-w-0 flex-1 truncate">
          · {count(thread.comments.length, "comment")}
          {thread.resolvedBy === null ? "" : ` · resolved by ${thread.resolvedBy}`}
        </span>
        <span>{ago(thread.at, now).replace(" ago", "")}</span>
      </button>
      {open && <Thread {...props} thread={thread} />}
    </div>
  );
};

export const TimelineEntryView = (props: EntryProps & { readonly entry: Entry }) => {
  const { entry } = props;

  if (entry.kind === "threads") return <Threads {...props} entry={entry} />;

  if (entry.kind === "resolved") return <Resolved {...props} thread={entry.thread} />;

  const { item } = entry;

  if (item.kind === "push") return <Push item={item} now={props.now} />;

  return item.kind === "thread" ? null : <Said {...props} item={item} />;
};
