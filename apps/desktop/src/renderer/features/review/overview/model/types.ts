/**
 * What Overview reads: the pull request's description, timeline, commits, checks and bot
 * summary (from `github.pull.detail`), and the walkthrough and a session's prompts (from the
 * Risk Summary). The shapes ovbackend publishes; the views here only read them.
 */

import type { ReviewPrompt, Walkthrough } from "@polaris/protocol";
import type {
  BotSummaryView,
  CheckRunView,
  CommitView,
  PersonView,
  PublishedDescriptionView,
  TimelineItemView,
} from "../../../../../shared/github.ts";
import type { Plain } from "../../../../store/plain.ts";

export type {
  BotSummaryView,
  CheckRunView,
  CommitView,
  PersonView,
  PublishedDescriptionView,
  TimelineItemView,
};

export type AlertKind = NonNullable<BotSummaryView["verdict"]>["alert"];

export type CheckConclusion = NonNullable<CheckRunView["conclusion"]>;

export type ThreadCommentView = Extract<
  TimelineItemView,
  { readonly kind: "thread" }
>["comments"][number];

/** What Overview adds to a pull request's detail; every field optional on the wire. */
export interface PullOverviewView {
  readonly body: string;
  readonly timeline: ReadonlyArray<TimelineItemView>;
  readonly commits: ReadonlyArray<CommitView>;
  readonly checkRuns: ReadonlyArray<CheckRunView>;
  readonly botSummary: BotSummaryView | null;
  readonly viewerLastReview: { readonly at: string; readonly commitOid: string | null } | null;
  readonly published: PublishedDescriptionView | null;
}

export type WalkthroughView = Plain<Walkthrough>;

export type WalkthroughState = WalkthroughView["state"];

export type TurnPromptView = Plain<ReviewPrompt>;
