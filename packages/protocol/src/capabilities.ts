import { Schema, SchemaTransformation } from "effect";
import { HARNESS_CATALOGUE } from "./harnesses.ts";

/** Bumped only for changes capability negotiation can't absorb. */
export const PROTOCOL_VERSION = 1;

/**
 * Features negotiated in `hello`. A Client hides what a Daemon lacks, so an
 * older Daemon keeps working until the Desktop App upgrades it.
 */
export const Capability = Schema.Literals([
  "constellation",
  "constellation.defaults",
  "host.resources",
  /** `harness.<kind>`: the Daemon has that Harness's driver (one per catalogue entry). */
  ...HARNESS_CATALOGUE.map((harness) => harness.capability),
  /** `harness.models`: each Harness's Models on this Host. */
  "harness.models",
  /** `harness.commands`: each Harness's Skills and Slash Commands in a directory. */
  "harness.commands",
  /** `harness.availability` and `harness.watchAvailability`: each Harness's status on this Host. */
  "harness.availability",
  /** `harness.spinnerVerbs`: Claude Code's `spinnerVerbs` setting on this Host. */
  "harness.spinner-verbs",
  "workspace.setup",
  "session.steer",
  "session.fork",
  /** The `SetModel` command. */
  "session.set-model",
  "session.terminal-handoff",
  /** `session.terminalCommand`: the argv, cwd and env of the Harness TUI for "Open in terminal". */
  "session.terminal-command",
  /**
   * `ItemProgress` on session streams (running commands, live plans). A Client
   * announces it in `hello`; the Daemon only sends `ItemProgress` to Clients that did.
   */
  "session.live-items",
  /**
   * Subagents: `SubagentStarted`/`SubagentEnded`, a Subagent's own items (with a
   * `subagentId`), and `TurnDetail.subagents`. A Client announces it in `hello`;
   * the Daemon leaves all of these out for Clients that didn't.
   */
  "session.subagents",
  "files.read",
  "files.versioned",
  "files.write",
  "files.manage",
  "files.trash",
  "files.watch-file",
  "files.search",
  "files.watch",
  "inline.propose",
  "git.diff",
  /** `git.diff` answers `fileIndex`: each file's byte range in the patch, and its counts. */
  "git.diff-files",
  /** The `Turns` diff spec: a contiguous run of an Agent Session's Turns. */
  "git.diff-turns",
  /** `git.show`: a file's content at a revision (context expansion in Review). */
  "git.show",
  "attachments.stage",
  /** `attachments.settings`, `attachments.setSettings`, `attachments.clear`: cleanup in Settings. */
  "attachments.settings",
  "terminal",
  /** `terminal.attachBinary`: terminal output as raw bytes on the blob channel, not base64 JSON. */
  "terminal.binary",
  "blobs",
  /** `usage.query` and `usage.watch`: Usage and Plan Limits on this Host. */
  "usage",
  /**
   * The Review commands and events below each need their capability on both
   * sides: a Daemon sends their events only to Clients that announced it.
   */
  /** `SendFeedback` and `Turn.feedback`. */
  "session.feedback",
  /**
   * `AcceptTurns`, `LinkPullRequest`, `TurnsAccepted` / `TurnsReverted` / `SessionPullRequestLinked`,
   * and `session.acceptPlan` / `draftAccept` / `commitAccepted` / `pushAccepted`.
   */
  "session.accept",
  /** The Review Checkout commands, their events, the Host snapshot's checkouts, `review.checkoutStatus`. */
  "review.checkouts",
  /** `review.runRiskSummary`, `review.riskSummary`, `review.watchRiskSummary`. */
  "review.risk-summary",
  /** `review.askFinding`: follow-up questions to the Reviewer. */
  "review.ask",
  /** `RecordVerdict` and `review.verdicts`. */
  "review.verdicts",
  /** `review.reviewerSettings` and `review.setReviewerSettings`: Settings → Reviewer. */
  "review.reviewer-settings",
  /** Independent walkthrough state, Run/Stop RPCs and optional Reviewer settings. */
  "review.walkthrough",
  /** `review.riskSummary` by `LatestAt`: a repository's newest summary at a head, incremental ones too. */
  "review.latest-summary",
  /** `session.acceptPlan` with a null `throughTurnId`: through the latest Turn. */
  "session.accept-latest",
]);

export type Capability = typeof Capability.Type;

const isCapability = Schema.is(Capability);

/**
 * A capability list as it travels in `hello`. Names this build doesn't know are
 * dropped on decode instead of failing, so a newer Client can talk to an older
 * Daemon (and vice versa) and simply not use what the other side lacks.
 */
export const CapabilityList = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(
    Schema.Array(Capability),
    SchemaTransformation.transform<ReadonlyArray<Capability>, ReadonlyArray<string>>({
      decode: (names) => names.filter(isCapability),
      encode: (capabilities) => capabilities,
    })
  )
);
