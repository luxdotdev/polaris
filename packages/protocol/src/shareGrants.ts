/**
 * What a Teammate's connection may do (ADR 0112): an allowlist of RPCs and `dispatch`
 * Commands by role. A Commenter watches and comments; a Contributor acts in the shared
 * target as the owner can. Share management, archiving, terminals, file writes and every
 * Host-wide call stay the owner's and are never listed. Unlike `grants.ts` it is not
 * exhaustive: a new RPC or Command is refused to Teammates until someone lists it here.
 */
import { Schema } from "effect";
import { RpcGroup, RpcMiddleware } from "effect/rpc";
import type { Command } from "./commands.ts";
import type { ConstellationId } from "./constellation/domain.ts";
import {
  ConstellationAnswer,
  ConstellationDispatch,
  ConstellationMessage,
  ConstellationReview,
  ConstellationStatus,
  ConstellationWorkerStart,
  SubscribeConstellation,
} from "./constellation/rpc.ts";
import { NotFound } from "./errors.ts";
import { ExtensionTokenRejected, type GrantKind, NotGranted } from "./extensions.ts";
import type { DaemonRpcTag } from "./grants.ts";
import { Hello, LanguageIdentityError, ProtocolMismatch } from "./hello.ts";
import type { SessionId } from "./ids.ts";
import { CommandRejected, Dispatch, GitDiff, SubscribeSession } from "./rpc.ts";
import {
  isShareLive,
  NotShared,
  MuteShare,
  RefreshStatement,
  type Share,
  ShareTarget,
  StatementRejected,
  WatchSharePresence,
} from "./shares.ts";
import { ReadTurns } from "./turns.ts";
import { RegisterPush, UnregisterPush } from "./linkedDevices.ts";

/**
 * `open`: any Teammate connection, whatever it touches. A Grant: within a Share holding it.
 * `contributor`: within a Contributor's Share, for what no Grant names.
 */
export type ShareAccess = GrantKind | "open" | "contributor";

/** `dispatch` itself is decided per Command (`SHARE_COMMANDS`). */
export const SHARE_RPCS = {
  hello: "open",
  dispatch: "open",
  "account.refreshStatement": "open",
  subscribeSession: "read",
  "session.turns": "read",
  /** Only a diff of a covered session's Turns (`Turn`, `Turns`); a path touches nothing. */
  "git.diff": "read",
  "constellation.subscribe": "read",
  "shares.watchPresence": "read",
  /** Mutes the caller's own pushes about a target their Share covers. */
  "shares.mute": "read",
  /** The caller's own device, for Needs You about what its Contributor Shares cover. */
  "devices.registerPush": "open",
  "devices.unregisterPush": "open",
  "constellation.status": "read",
  /**
   * What the owner does through a Constellation's Lead, by Grant: start Workers, review Claims,
   * answer and message. Planning, pausing, completing, archiving and handing over
   * (`constellation.plan`, `constellation.set_state`) stay the owner's. The Daemon also keeps a
   * Teammate's Workers on this Host, in Worktrees, branches and bases it picks, and holds what starts agent work
   * back while Turns are.
   */
  "constellation.dispatch": "start",
  "constellation.worker.start": "start",
  "constellation.review": "approve",
  "constellation.answer": "turn",
  "constellation.message": "turn",
} as const satisfies Partial<Record<DaemonRpcTag, ShareAccess>>;

/**
 * `turn` and `approve` entries are what a Contributor's Share allows. A Teammate's `Allow`
 * holds for that request only: remembering it beyond the session is the owner's.
 */
export const SHARE_COMMANDS = {
  SendTurn: "turn",
  Steer: "turn",
  CancelQueuedTurn: "turn",
  ResumeQueue: "turn",
  EditQueuedTurn: "turn",
  Interrupt: "turn",
  Continue: "turn",
  Retry: "turn",
  SendFeedback: "turn",
  RespondToApproval: "approve",
  SetModel: "contributor",
  SetPermissionMode: "contributor",
  RenameSession: "contributor",
  AcceptTurns: "contributor",
  AddComment: "comment",
  EditComment: "comment",
  ResolveComment: "comment",
  ReopenComment: "comment",
} as const satisfies Partial<Record<Command["_tag"], Exclude<ShareAccess, "open">>>;

/**
 * What a request touches, as the Host resolves it from the payload: its Agent Session,
 * and the Constellation that session belongs to (as Lead or Worker) or the request names.
 * Both null for a request about the Host or a path.
 */
export interface ShareTouch {
  readonly sessionId: SessionId | null;
  readonly constellationId: ConstellationId | null;
}

/** A session Share covers that session; a Constellation Share its Lead's and Workers' sessions. */
export const shareCovers = (target: ShareTarget, touch: ShareTouch): boolean =>
  ShareTarget.match(target, {
    Session: (t) => touch.sessionId === t.sessionId,
    Constellation: (t) => touch.constellationId === t.constellationId,
  });

const shareAccess = (rpc: string, command: string | null): ShareAccess | null => {
  const table: Readonly<Record<string, ShareAccess>> =
    rpc === "dispatch" ? SHARE_COMMANDS : SHARE_RPCS;

  const tag = rpc === "dispatch" ? (command ?? "") : rpc;

  return Object.hasOwn(table, tag) ? (table[tag] ?? null) : null;
};

/**
 * The refusal for a request on a Teammate's connection, or null when it may proceed.
 * `shares` are the connection's person's Shares on this Host and `now` the Host's clock in
 * milliseconds. For `dispatch`, `command` is the Command's tag. `NotShared`: only the owner may,
 * no live Share covers `touch`, or it takes a Contributor and none of them is one.
 * `NotGranted`: one covers it, and none holds the Grant.
 */
export const decideShareAccess = (
  shares: ReadonlyArray<Share>,
  now: number,
  rpc: string,
  command: string | null,
  touch: ShareTouch
): NotShared | NotGranted | null => {
  const what = rpc === "dispatch" ? `dispatch:${command ?? ""}` : rpc;
  const access = shareAccess(rpc, command);

  if (access === null) return new NotShared({ what });

  if (access === "open") return null;

  const covering = shares.filter(
    (share) => isShareLive(share, now) && shareCovers(share.target, touch)
  );

  if (covering.length === 0) return new NotShared({ what });

  if (access === "contributor")
    return covering.some((share) => share.role === "contributor") ? null : new NotShared({ what });

  return covering.some((share) => share.grant.includes(access))
    ? null
    : new NotGranted({ what, needed: access });
};

/** The Daemon refuses, in front of every handler, what a Teammate's Shares do not allow. */
export class ShareGate extends RpcMiddleware.Service<ShareGate>()("polaris/protocol/ShareGate", {
  error: Schema.Union([NotShared, NotGranted]),
}) {}

/**
 * What a Teammate's Client calls: the RPCs of `SHARE_RPCS`, each able to fail with the Share
 * gate's refusals. `hello` also fails with `StatementRejected`, and `dispatch` with the
 * commit decision's `NotGranted` (`decideTurnAccess`). `shareGrants.test.ts` holds it in step
 * with `SHARE_RPCS`.
 */
export const TeammateRpcs = RpcGroup.make(
  Hello.setError(
    Schema.Union([
      LanguageIdentityError,
      ExtensionTokenRejected,
      ProtocolMismatch,
      StatementRejected,
    ])
  ),
  Dispatch.setError(Schema.Union([CommandRejected, NotFound, NotGranted])),
  RefreshStatement,
  SubscribeSession,
  ReadTurns,
  GitDiff,
  SubscribeConstellation,
  WatchSharePresence,
  MuteShare,
  RegisterPush,
  UnregisterPush,
  ConstellationStatus,
  ConstellationDispatch,
  ConstellationWorkerStart,
  ConstellationReview,
  ConstellationAnswer,
  ConstellationMessage
).middleware(ShareGate);
