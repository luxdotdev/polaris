/** GitHub's GraphQL shapes turned into the views the renderer gets. */
import type {
  DiffSide,
  PullDetailView,
  PullFileView,
  ReviewThreadView,
  ThreadAnchor,
  ViewedState,
} from "../../shared/github.ts";
import type { PullDetailData, ReviewThread } from "./queries.ts";
import { personView } from "./overview.ts";
import { checksOf, githubStack } from "./stacks.ts";

type Detail = NonNullable<NonNullable<PullDetailData["repository"]>["pullRequest"]>;

const VIEWED = new Map<string, ViewedState>([
  ["VIEWED", "viewed"],
  ["DISMISSED", "dismissed"],
]);

const STATES = new Map<string, PullDetailView["state"]>([
  ["CLOSED", "closed"],
  ["MERGED", "merged"],
]);

export const sideOf = (side: string | null): DiffSide => (side === "LEFT" ? "left" : "right");

export const fileView = (file: Detail["files"]["nodes"][number]): PullFileView => ({
  path: file.path,
  additions: file.additions,
  deletions: file.deletions,
  changeType: file.changeType,
  viewed: VIEWED.get(file.viewerViewedState) ?? "unviewed",
});

/** A line thread whose `line` is gone is outdated: anchor it where it was first made. */
export const anchorOf = (thread: ReviewThread): ThreadAnchor => {
  const first = thread.comments.nodes[0];

  if (thread.subjectType === "FILE") return { kind: "file" };

  if (thread.line !== null) {
    return {
      kind: "line",
      line: thread.line,
      startLine: thread.startLine,
      side: sideOf(thread.diffSide),
      startSide: thread.startLine === null ? null : sideOf(thread.startDiffSide),
    };
  }

  return {
    kind: "outdated",
    originalLine: thread.originalLine,
    originalStartLine: thread.originalStartLine,
    side: sideOf(thread.diffSide),
    commitOid: first?.originalCommit?.oid ?? null,
    diffHunk: first?.diffHunk ?? "",
  };
};

export const threadView = (thread: ReviewThread): ReviewThreadView => ({
  id: thread.id,
  path: thread.path,
  isResolved: thread.isResolved,
  isOutdated: thread.isOutdated,
  resolvedBy: thread.resolvedBy?.login ?? null,
  diffHunk: thread.comments.nodes[0]?.diffHunk ?? "",
  anchor: anchorOf(thread),
  comments: thread.comments.nodes.map((c) => ({
    id: c.id,
    author: c.author?.login ?? null,
    body: c.body,
    createdAt: c.createdAt,
    url: c.url,
    pending: c.state === "PENDING",
    person: personView(c.author),
  })),
});

export interface DetailParts {
  readonly pull: Detail;
  readonly repo: string;
  readonly host: string;
  readonly viewerLogin: string;
  readonly files: ReadonlyArray<Detail["files"]["nodes"][number]>;
  readonly threads: ReadonlyArray<ReviewThread>;
  readonly accountId: number;
}

export const detailView = ({
  pull,
  repo,
  host,
  viewerLogin,
  files,
  threads,
  accountId,
}: DetailParts): PullDetailView => {
  const pending = pull.reviews.nodes[0];

  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    body: pull.body,
    url: pull.url,
    repo,
    host,
    state: STATES.get(pull.state) ?? "open",
    isDraft: pull.isDraft,
    author: pull.author,
    viewerLogin,
    viewerCanApprove: pull.author?.login !== viewerLogin,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName,
    baseRefOid: pull.baseRefOid,
    commits: pull.commits.totalCount,
    files: files.map(fileView),
    threads: threads.map(threadView),
    pendingReview:
      pending === undefined
        ? null
        : {
            id: pending.id,
            commitOid: pending.commit?.oid ?? null,
            comments: pending.comments.totalCount,
          },
    accountId,
    checks: checksOf(pull.checks),
    stack: githubStack(pull.stack, pull.stackEntry),
  };
};
