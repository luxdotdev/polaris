/**
 * What only the user may do on a Host (ENG-700, ADR 0100, 0114): every RPC and `dispatch`
 * Command is `user` or `any`, exhaustive over `DaemonRpcs` and `Command` so a new one
 * fails typecheck until someone decides. A token-less connection gets `user` only after
 * its `hello` presented an enrolled user key; Extensions and Linked Devices keep their own
 * gates (`grants.ts`, `deviceGrants.ts`) and never pass through this one.
 */
import { Schema } from "effect";
import { type Rpc, type RpcGroup, RpcMiddleware } from "effect/rpc";
import type { Command } from "./commands.ts";
import type { DaemonRpcTag } from "./grants.ts";

/**
 * `user`: the connection must hold user access. `any`: any token-less connection, and only for
 * a request that reads or watches and changes nothing on the Host beyond its own connection.
 * Whatever writes, deletes, installs, runs or configures a process, changes git state or a
 * setting is `user` (ADR 0114). `userAccess.test.ts` lists every `any`: add one there on purpose.
 */
export type UserAccessNeed = "user" | "any";

/**
 * A user-only RPC or Command from a connection without user access: a process
 * that reached the socket, or a Desktop App whose user key this Host has not enrolled.
 */
export class UserAccessRequired extends Schema.TaggedError<UserAccessRequired>()(
  "UserAccessRequired",
  {
    /** The RPC (`secret.provide`) or Command (`dispatch:RespondToApproval`) that was refused. */
    what: Schema.String,
  }
) {
  override get message(): string {
    return `${this.what} is only for a Desktop App this Host has enrolled`;
  }
}

/** The Daemon refuses, with `UserAccessRequired`, a user-only request without user access. */
export class UserAccessGate extends RpcMiddleware.Service<UserAccessGate>()(
  "polaris/protocol/UserAccessGate",
  { error: UserAccessRequired }
) {}

/** A user key: 32 random bytes as hex, held by the Desktop App and never by the Host. */
export const UserKey = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

/** `dispatch` is decided per Command, and every Command changes the Host: none is `any`. */
export const USER_COMMANDS = {
  RegisterWorkspace: "user",
  SetWorktreeSetup: "user",
  SetWorkspaceHidden: "user",
  RemoveWorkspace: "user",
  StartSession: "user",
  SendTurn: "user",
  RunShellCommand: "user",
  CompactSession: "user",
  Steer: "user",
  CancelQueuedTurn: "user",
  ResumeQueue: "user",
  EditQueuedTurn: "user",
  Interrupt: "user",
  StopBackgroundTasks: "user",
  BackgroundCommand: "user",
  Continue: "user",
  Retry: "user",
  RespondToApproval: "user",
  RenameSession: "user",
  PinSession: "user",
  SetResumeAtReset: "user",
  SetPermissionMode: "user",
  SetModel: "user",
  ForkSession: "user",
  ArchiveSession: "user",
  UnarchiveSession: "user",
  OpenInTerminal: "user",
  ReturnFromTerminal: "user",
  SendFeedback: "user",
  AddComment: "user",
  EditComment: "user",
  ResolveComment: "user",
  ReopenComment: "user",
  AcceptTurns: "user",
  LinkPullRequest: "user",
  OpenReviewCheckout: "user",
  ReportReviewHead: "user",
  UpdateReviewCheckout: "user",
  RemoveReviewCheckout: "user",
  RecordVerdict: "user",
} as const satisfies Record<Command["_tag"], UserAccessNeed>;

/**
 * `any` RPCs are the reads and watches, `hello`, `dispatch` (decided per Command), a
 * connection's own flow control, and `host.resources.acquire` and `release`: `polaris lease`
 * sends no key, a lease ends with the process it names, and without user access a connection
 * releases only a lease it asked for. A read of file contents, a stored credential or a
 * provider key is `user`, and so is whatever connects to an address its caller names. Handlers
 * of `traces.watch`, `harness.models` and `harness.commands` do less without user access.
 */
export const USER_RPCS = {
  hello: "any",
  dispatch: "any",
  subscribeHost: "any",
  subscribeSession: "any",
  "session.turns": "any",
  "session.terminalCommand": "any",
  "harness.models": "any",
  "harness.commands": "any",
  "harness.spinnerVerbs": "any",
  "harness.availability": "any",
  "harness.watchAvailability": "any",
  "usage.query": "any",
  "usage.watch": "any",
  "extensions.pair": "user",
  "extensions.list": "any",
  "extensions.revoke": "user",
  "remoteAccess.status": "any",
  "remoteAccess.enable": "user",
  "remoteAccess.disable": "user",
  "host.restartPreview": "any",
  "host.prepareRestart": "user",
  "relayRoute.status": "any",
  "relayRoute.enable": "user",
  "relayRoute.setUrl": "user",
  "relayRoute.disable": "user",
  "devices.link": "user",
  "devices.awaitLink": "user",
  "devices.cancelLink": "user",
  "devices.add": "user",
  "devices.list": "any",
  "devices.unlink": "user",
  "devices.unlinkSelf": "user",
  "devices.registerPush": "user",
  "devices.unregisterPush": "user",
  "devices.registerLiveActivity": "user",
  "devices.unregisterLiveActivity": "user",
  "devices.watch": "any",
  "userAccess.watch": "any",
  "userAccess.allow": "user",
  "userAccess.deny": "user",
  "userAccess.revoke": "user",
  // Spends the Host's provider key; a Linked Device's own gate still admits it.
  "voice.transcribe": "user",
  "voice.settings": "any",
  "voice.setKey": "user",
  "secret.provide": "user",
  "sessions.autoArchive": "any",
  "sessions.setAutoArchive": "user",
  "sessions.idleCompaction": "any",
  "sessions.setIdleCompaction": "user",
  "sessions.suggestedReplies": "any",
  "sessions.setSuggestedReplies": "user",
  "sessions.visuals": "any",
  "sessions.setVisuals": "user",
  "continuity.watch": "any",
  "continuity.markRead": "user",
  "continuity.saveDraft": "user",
  "presence.report": "user",
  "data.sources.watch": "any",
  "traces.watch": "any",
  "traces.get": "any",
  "traces.span": "any",
  "traces.settings": "any",
  "traces.setSettings": "user",
  "profiles.watch": "any",
  "profiles.get": "any",
  "profiles.attach": "user",
  "profiles.restartWithProfiling": "user",
  "traces.compare": "any",
  "data.schemaDiff": "any",
  "data.describe": "user",
  "data.edits.commit": "user",
  "data.query": "user",
  "data.queryLog.watch": "any",
  "data.source.save": "user",
  "data.source.remove": "user",
  "data.source.label": "user",
  "data.query.stream": "user",
  "data.queryLog.page": "any",
  "data.source.access": "user",
  "host.stats.watch": "any",
  "byteStream.credit": "any",
  "hostAddress.open": "user",
  "hostAddress.names": "any",
  "browser.host": "user",
  "browser.claim": "user",
  "browser.release": "user",
  "browser.acceptStream": "user",
  "browser.closeStream": "user",
  "attachments.stage": "user",
  "attachments.read": "user",
  "attachments.settings": "any",
  "attachments.setSettings": "user",
  "attachments.clear": "user",
  "inline.propose": "user",
  "commit.suggestMessage": "user",
  "prediction.capability": "user",
  "prediction.complete": "user",
  "prediction.context": "any",
  "prediction.edit": "user",
  "prediction.managed": "user",
  "prediction.managed.watch": "any",
  "prediction.server": "user",
  "files.listDir": "any",
  "files.stat": "any",
  "files.read": "user",
  "files.readVersioned": "user",
  "files.searchPaths": "any",
  "files.grep": "user",
  "files.watch": "any",
  "files.watchFile": "any",
  "files.write": "user",
  "files.create": "user",
  "files.delete": "user",
  "files.rename": "user",
  "git.status": "any",
  "git.diff": "user",
  "git.show": "user",
  "git.stage": "user",
  "git.unstage": "user",
  "git.discard": "user",
  "git.commit": "user",
  "git.init": "user",
  "git.sync": "user",
  "git.watch": "any",
  "git.log": "user",
  "git.blame": "user",
  "origins.match": "any",
  "origins.forCommit": "any",
  "review.checkoutStatus": "any",
  "review.runRiskSummary": "user",
  "review.runWalkthrough": "user",
  "review.stopWalkthrough": "user",
  "review.riskSummary": "any",
  "review.watchRiskSummary": "any",
  "review.askFinding": "user",
  "review.verdicts": "any",
  "review.reviewerSettings": "any",
  "review.setReviewerSettings": "user",
  "session.acceptPlan": "any",
  "session.draftAccept": "user",
  "session.commitAccepted": "user",
  "session.pushAccepted": "user",
  "terminal.open": "user",
  "terminal.attach": "any",
  "terminal.attachBinary": "any",
  "terminal.input": "user",
  "terminal.resize": "user",
  "terminal.close": "user",
  "constellation.answer": "user",
  "constellation.assignment.list": "any",
  "constellation.assignment.set": "user",
  "constellation.base.export": "user",
  "constellation.base.import": "user",
  "constellation.bundle.export": "user",
  "constellation.bundle.import": "user",
  "constellation.claim.export": "user",
  "constellation.connection": "user",
  "constellation.defaults.get": "any",
  "constellation.defaults.set": "user",
  "constellation.delivery.ack": "user",
  "constellation.delivery.apply": "user",
  "constellation.delivery.watch": "user",
  "constellation.dispatch": "user",
  "constellation.message": "user",
  "constellation.origin.import": "user",
  "constellation.outbox.ack": "user",
  "constellation.outbox.apply": "user",
  "constellation.outbox.watch": "user",
  "constellation.placement.resolve": "user",
  "constellation.placements.watch": "user",
  "constellation.plan": "user",
  "constellation.repository.prepare": "user",
  "constellation.review": "user",
  "constellation.set_state": "user",
  "constellation.stats": "any",
  "constellation.status": "any",
  "constellation.subscribe": "any",
  "constellation.worker.ask": "user",
  "constellation.worker.block": "user",
  "constellation.worker.claim": "user",
  "constellation.worker.message": "user",
  "constellation.worker.prepare": "user",
  "constellation.worker.progress": "user",
  "constellation.worker.propose": "user",
  "constellation.worker.start": "user",
  "constellation.worktree.prepare": "user",
  "host.resources.acquire": "any",
  "host.resources.declare": "user",
  "host.resources.get": "any",
  "host.resources.release": "any",
  "host.resources.remove": "user",
  "host.workers.setCap": "user",
  "languages.availability": "any",
  "languages.availability.watch": "any",
  "languages.cancel": "user",
  "languages.catalog": "any",
  "languages.context.acquire": "user",
  "languages.context.configure": "user",
  "languages.context.release": "user",
  "languages.context.restart": "user",
  "languages.context.watch": "any",
  "languages.discover": "any",
  "languages.document.acknowledge": "user",
  "languages.document.sync": "user",
  "languages.edit.decide": "user",
  "languages.edit.prepare": "user",
  "languages.format": "user",
  "languages.format.project": "user",
  "languages.host.processBudget.get": "any",
  "languages.host.processBudget.set": "user",
  "languages.host.state": "any",
  "languages.host.state.watch": "any",
  "languages.install": "user",
  "languages.install.cancel": "user",
  "languages.install.watch": "any",
  "languages.log.watch": "any",
  "languages.operation.get": "any",
  "languages.operation.recover": "user",
  "languages.preview.media": "any",
  "languages.progress.cancel": "user",
  "languages.python.interpreters": "any",
  "languages.python.select": "user",
  "languages.request": "user",
  "languages.server.respond": "user",
  "languages.server.restart": "user",
  "languages.sql.dialect.get": "any",
  "languages.sql.dialect.select": "user",
  "languages.tree.edit.decide": "user",
  "languages.tree.operation.get": "any",
  "languages.tree.operation.recover": "user",
  "languages.trust.change": "user",
  "languages.trust.get": "any",
  "languages.trust.inspect": "any",
  "languages.trust.set": "user",
  "languages.workspace.restart": "user",
  "data.source.saveFile": "user",
  "developerMode.get": "any",
  "developerMode.set": "user",
  "developerMode.setWorkspace": "user",
  "developerMode.lease": "user",
  "developerMode.watch": "any",
  "traces.ingestSelf": "user",
  "traces.installSkill": "user",
  "requests.watch": "any",
  "requests.save": "user",
  "requests.send": "user",
  "requests.variables": "user",
  "requests.sendLog.page": "any",
  "requests.sendLog.watch": "any",
  "requests.send.get": "any",
  "requests.curl.parse": "any",
  "requests.curl.format": "user",
  "shares.create": "user",
  "shares.renew": "user",
  "shares.revoke": "user",
  "shares.list": "any",
  "shares.watchPresence": "any",
  "account.refreshStatement": "user",
  "simulator.watch": "any",
  "simulator.boot": "user",
  "simulator.shutdown": "user",
  "simulator.restart": "user",
  "simulator.attach": "user",
  "simulator.sessionFeed": "any",
  "computerUse.status": "any",
  "computerUse.watch": "any",
  "computerUse.enable": "user",
  "computerUse.disable": "user",
  "computerUse.openSetup": "user",
  "computerUse.allowedApps": "any",
  "computerUse.removeAllowedApp": "user",
  "computerUse.allowedApps.add": "user",
  "computerUse.app": "any",
  "computerUse.preview.watch": "user",
  "computerUse.preview.latest": "user",
} as const satisfies Record<DaemonRpcTag, UserAccessNeed>;

/** The RPCs the user gate decides: every `user` one, and `dispatch`, decided per Command. */
type GatedTag =
  | "dispatch"
  | {
      [K in keyof typeof USER_RPCS]: (typeof USER_RPCS)[K] extends "user" ? K : never;
    }[keyof typeof USER_RPCS];

const isGated = (tag: string) =>
  tag === "dispatch" || (Object.hasOwn(USER_RPCS, tag) && needOf(USER_RPCS, tag) === "user");

/**
 * `group` with the user gate on what it decides, so a Client decodes its `UserAccessRequired`;
 * RPCs it never refuses keep their errors.
 */
export const gateUserRpcs = <R extends Rpc.Any>(group: RpcGroup.RpcGroup<R>) => {
  const tags = [...group.requests.keys()];
  const gated = tags.filter((tag): tag is Extract<R["_tag"], GatedTag> => isGated(tag));
  const open = tags.filter((tag): tag is Exclude<R["_tag"], GatedTag> => !isGated(tag));

  return group.omit(...gated).merge(group.omit(...open).middleware(UserAccessGate));
};

const needOf = (table: Readonly<Record<string, UserAccessNeed>>, tag: string): UserAccessNeed =>
  Object.hasOwn(table, tag) ? (table[tag] ?? "user") : "user";

/**
 * The refusal for a request on a token-less connection, or null when it may proceed.
 * `held`: the connection's `hello` presented an enrolled user key. Unknown tags need it.
 */
export const decideUserAccess = (
  rpc: string,
  command: string | null,
  held: boolean
): UserAccessRequired | null => {
  if (held) return null;

  if (rpc === "dispatch")
    return needOf(USER_COMMANDS, command ?? "") === "user"
      ? new UserAccessRequired({ what: `dispatch:${command ?? ""}` })
      : null;

  return needOf(USER_RPCS, rpc) === "user" ? new UserAccessRequired({ what: rpc }) : null;
};
