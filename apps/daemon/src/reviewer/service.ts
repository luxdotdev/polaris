/** The Reviewer's service tag, apart from its implementation so the Daemon can load that on first use. */
import type {
  GitError,
  HarnessUnavailable,
  NotFound,
  ResolvedReviewer,
  ReviewContext,
  ReviewerSettings,
  RiskFindingId,
  RiskSummary,
  RiskSummaryId,
  SessionId,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { Context, type Effect } from "effect";
import type { ServiceError } from "../services.ts";
import type { RunRequest } from "./run.ts";

export class Reviewer extends Context.Service<
  Reviewer,
  {
    /** Start a Risk Summary (Rules, then the Reviewer), or answer the cached one. */
    readonly run: (request: RunRequest) => Effect.Effect<RiskSummary, NotFound | GitError>;
    /** Start a Risk Summary nobody asked for (`automaticRun`); its failures are ignored. */
    readonly runAutomatic: (request: RunRequest) => Effect.Effect<void>;
    readonly runWalkthrough: (
      summaryId: RiskSummaryId,
      context: ReviewContext | null
    ) => Effect.Effect<RiskSummary, NotFound | GitError>;
    readonly stopWalkthrough: (summaryId: RiskSummaryId) => Effect.Effect<void, NotFound>;
    readonly ask: (
      summaryId: RiskSummaryId,
      findingId: RiskFindingId | null,
      question: string
    ) => Effect.Effect<
      { readonly sessionId: SessionId; readonly turnId: TurnId },
      NotFound | HarnessUnavailable
    >;
    readonly settings: (workspaceId: WorkspaceId | null) => Effect.Effect<{
      readonly settings: ReviewerSettings;
      readonly resolved: ResolvedReviewer;
    }>;
    readonly setSettings: (settings: ReviewerSettings) => Effect.Effect<void, ServiceError>;
  }
>()("polaris/daemon/reviewer/Reviewer") {}
