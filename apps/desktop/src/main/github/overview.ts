import { Effect, Match } from "effect";
import type {
  CheckRunView,
  CommitView,
  PersonView,
  PullDetailView,
  TimelineItemView,
} from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { latestBotSummary, summaryBot } from "./botSummary.ts";
import {
  type CheckContext,
  type OverviewPull,
  type Person,
  PullOverviewData,
  pullOverview,
} from "./overviewQueries.ts";

export const personView = (person: typeof Person.Type): PersonView => {
  const view = {
    login: (person?.login ?? "deleted").replace(/\[bot\]$/i, ""),
    bot: person?.__typename === "Bot" || /\[bot\]$/i.test(person?.login ?? ""),
  };

  return person?.avatarUrl === undefined ? view : { ...view, avatarUrl: person.avatarUrl };
};

const CONCLUSIONS = new Map<string, CheckRunView["conclusion"]>([
  ["SUCCESS", "success"],
  ["FAILURE", "failure"],
  ["ERROR", "failure"],
  ["NEUTRAL", "neutral"],
  ["SKIPPED", "skipped"],
  ["CANCELLED", "cancelled"],
  ["TIMED_OUT", "timed-out"],
  ["ACTION_REQUIRED", "action-required"],
  ["STALE", "stale"],
]);

const REVIEW_STATES = new Map<string, "approved" | "changes-requested" | "commented" | "dismissed">(
  [
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes-requested"],
    ["COMMENTED", "commented"],
    ["DISMISSED", "dismissed"],
  ]
);

const checkView = (c: typeof CheckContext.Type): CheckRunView => {
  const raw = c.status ?? c.state ?? "PENDING";
  const startedAt = c.startedAt ?? null;
  const completedAt = c.completedAt ?? null;

  const status =
    raw === "IN_PROGRESS"
      ? "in-progress"
      : raw === "COMPLETED" || CONCLUSIONS.has(raw)
        ? "completed"
        : "queued";

  return {
    name: c.name ?? c.context ?? "Check",
    workflow: c.checkSuite?.workflowRun?.workflow.name ?? null,
    status,
    conclusion: CONCLUSIONS.get(c.conclusion ?? c.state ?? "") ?? null,
    startedAt,
    completedAt,
    durationMs:
      startedAt === null || completedAt === null
        ? null
        : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    url: c.detailsUrl ?? c.targetUrl ?? null,
  };
};

const commitView = ({ commit: c }: OverviewPull["commitList"]["nodes"][number]): CommitView => ({
  oid: c.oid,
  headline: c.messageHeadline,
  body: c.messageBody,
  author:
    c.author === null
      ? null
      : c.author.user === null
        ? { login: c.author.name ?? "unknown", bot: false }
        : personView(c.author.user),
  at: c.committedDate,
  checks:
    c.statusCheckRollup === null
      ? null
      : {
          state:
            c.statusCheckRollup.state === "SUCCESS"
              ? "success"
              : ["FAILURE", "ERROR"].includes(c.statusCheckRollup.state)
                ? "failure"
                : "pending",
          total: c.statusCheckRollup.contexts.totalCount,
        },
});

export const timelineThreads = (view: PullDetailView): ReadonlyArray<TimelineItemView> =>
  view.threads.flatMap((thread) => {
    const comments = thread.comments
      .filter((c) => !c.pending)
      .map((c) => ({
        id: c.id,
        author: c.person ?? personView(c.author === null ? null : { login: c.author }),
        body: c.body,
        at: c.createdAt,
        url: c.url,
      }));

    const first = comments[0];

    return first === undefined
      ? []
      : [
          {
            kind: "thread",
            id: thread.id,
            at: first.at,
            url: first.url,
            threadId: thread.id,
            path: thread.path,
            line: Match.value(thread.anchor).pipe(
              Match.when({ kind: "line" }, (anchor) => anchor.line),
              Match.when({ kind: "outdated" }, (anchor) => anchor.originalLine),
              Match.orElse(() => null)
            ),
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
            resolvedBy: thread.resolvedBy ?? null,
            diffHunk:
              thread.diffHunk ?? (thread.anchor.kind === "outdated" ? thread.anchor.diffHunk : ""),
            comments,
          },
        ];
  });

interface OverviewData {
  comments: Array<OverviewPull["comments"]["nodes"][number]>;
  reviews: Array<OverviewPull["submittedReviews"]["nodes"][number]>;
  commits: Array<OverviewPull["commitList"]["nodes"][number]>;
  checks: Array<typeof CheckContext.Type>;
}

interface Cursors {
  comments: string | null;
  reviews: string | null;
  commits: string | null;
  checks: string | null;
}

type ConnectionName = keyof Cursors;

const CONNECTIONS: ReadonlyArray<ConnectionName> = ["comments", "reviews", "commits", "checks"];

type Pages = {
  comments: OverviewPull["comments"];
  reviews: OverviewPull["submittedReviews"];
  commits: OverviewPull["commitList"];
  checks: {
    readonly nodes: ReadonlyArray<typeof CheckContext.Type>;
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  } | null;
};

const advancePages = (active: ReadonlySet<ConnectionName>, pages: Pages, cursors: Cursors) => {
  const next = new Set<ConnectionName>();

  for (const key of active) {
    const page = pages[key];
    const cursor = page?.pageInfo.endCursor ?? null;

    if (page?.pageInfo.hasNextPage === true && cursor !== null && cursor !== cursors[key]) {
      cursors[key] = cursor;
      next.add(key);
    }
  }

  return next;
};

const readPages = (client: Client, accountId: number, view: PullDetailView) =>
  Effect.gen(function* () {
    const all: OverviewData = { comments: [], reviews: [], commits: [], checks: [] };
    const cursors: Cursors = { comments: null, reviews: null, commits: null, checks: null };
    let active = new Set(CONNECTIONS);

    while (active.size > 0) {
      const data = yield* client.graphql(
        accountId,
        PullOverviewData,
        pullOverview({ id: view.id, ...cursors })
      );

      if (data.node === null) break;

      const pages = {
        comments: data.node.comments,
        reviews: data.node.submittedReviews,
        commits: data.node.commitList,
        checks: data.node.headChecks.nodes[0]?.commit.statusCheckRollup?.contexts ?? null,
      };

      if (active.has("comments")) all.comments.push(...pages.comments.nodes);

      if (active.has("reviews")) all.reviews.push(...pages.reviews.nodes);

      if (active.has("commits")) all.commits.push(...pages.commits.nodes);

      if (active.has("checks")) all.checks.push(...(pages.checks?.nodes ?? []));
      active = advancePages(active, pages, cursors);
    }

    return all;
  });

const overviewView = (all: OverviewData, view: PullDetailView) => {
  const timeline: Array<TimelineItemView> = [...timelineThreads(view)];

  for (const c of all.comments.filter((c) => summaryBot(c.body) === null))
    timeline.push({
      kind: "comment",
      id: c.id,
      at: c.createdAt,
      url: c.url,
      author: personView(c.author),
      body: c.body,
    });

  for (const r of all.reviews) {
    const state = REVIEW_STATES.get(r.state);

    if (state !== undefined && r.submittedAt !== null)
      timeline.push({
        kind: "review",
        id: r.id,
        at: r.submittedAt,
        url: r.url,
        author: personView(r.author),
        state,
        body: r.body,
      });
  }

  const commitList = all.commits.map(commitView);

  for (const [i, c] of commitList.entries())
    timeline.push({
      kind: "push",
      id: c.oid,
      at: c.at,
      url: all.commits[i]?.commit.url ?? view.url,
      author: c.author,
      commits: [{ oid: c.oid, headline: c.headline }],
      forced: false,
    });

  const last = all.reviews
    .filter(
      (r) => r.author?.login === view.viewerLogin && r.state !== "PENDING" && r.submittedAt !== null
    )
    .toSorted((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0];

  return {
    timeline: timeline.toSorted((a, b) => a.at.localeCompare(b.at)),
    commitList,
    checkRuns: all.checks.map(checkView),
    botSummary: latestBotSummary(all.comments),
    viewerLastReview:
      last?.submittedAt == null
        ? null
        : { at: last.submittedAt, commitOid: last.commit?.oid ?? null },
  };
};

export const fetchOverview = (client: Client, accountId: number, view: PullDetailView) =>
  Effect.map(readPages(client, accountId, view), (all) => overviewView(all, view));
