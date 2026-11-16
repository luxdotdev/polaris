/**
 * The thread's source on a Teammate's connection (ADR 0112): the session's feed, its commands
 * and older Turns, which a Share allows (`SHARE_RPCS`). Read positions, drafts, Workspaces and
 * Risk Summaries are the owner's, so the thread goes without them.
 */
import { Effect, Stream } from "effect";
import type { LiveSource } from "@polaris/client/resume";
import {
  daemonThreadSource,
  ThreadFailure,
  type ThreadClient,
  type ThreadSource,
} from "../thread/source.ts";

const ownersOnly = new ThreadFailure({ message: "Only the owner keeps this" });

export const teammateThreadSource = (
  live: LiveSource<ThreadClient>,
  capabilities: ReadonlySet<string>
): ThreadSource => {
  // Continuity and Risk Summaries are off: the shared source never asks for them.
  const allowed = new Set(
    [...capabilities].filter((c) => c !== "session.continuity" && c !== "review.risk-summary")
  );

  const source = daemonThreadSource({ live, capabilities: allowed });

  return {
    ...source,
    continuity: Stream.empty,
    findings: () => Stream.empty,
    workspace: () => Effect.succeed(null),
    markRead: () => Effect.fail(ownersOnly),
    saveDraft: () => Effect.fail(ownersOnly),
    provideSecret: () => Effect.fail(ownersOnly),
  };
};
