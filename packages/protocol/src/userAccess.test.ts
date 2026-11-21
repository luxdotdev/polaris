import { expect, test } from "bun:test";
import { decideUserAccess, USER_COMMANDS, USER_RPCS, type UserAccessNeed } from "./userAccess.ts";

test("an RPC or Command the table doesn't know needs user access", () => {
  expect(decideUserAccess("files.purge", null, false)?.what).toBe("files.purge");
  expect(decideUserAccess("dispatch", "ApproveEverything", false)?.what).toBe(
    "dispatch:ApproveEverything"
  );
  expect(decideUserAccess("dispatch", null, false)?.what).toBe("dispatch:");
});

test("a Daemon's own CLIs keep their RPCs without a key", () => {
  for (const rpc of ["host.resources.acquire", "constellation.stats", "extensions.list"])
    expect(decideUserAccess(rpc, null, false)).toBeNull();
});

/**
 * Reviewed: each reads or watches and changes nothing on the Host beyond its caller's own
 * connection. `host.resources.acquire` and `release` are the exception (`polaris lease` sends
 * no key; a lease ends with the process it names, and without user access a connection releases
 * only a lease it asked for). `git.status` and `git.watch` still run git under the
 * repository's own config (ENG-953). A new `any` fails here until it is added on purpose.
 */
const READ_ONLY = [
  "attachments.settings",
  "byteStream.credit",
  "computerUse.allowedApps",
  "computerUse.app",
  "computerUse.status",
  "computerUse.watch",
  "constellation.assignment.list",
  "constellation.defaults.get",
  "constellation.stats",
  "constellation.status",
  "constellation.subscribe",
  "continuity.watch",
  "data.queryLog.page",
  "data.queryLog.watch",
  "data.schemaDiff",
  "data.sources.watch",
  "developerMode.get",
  "developerMode.watch",
  "devices.list",
  "devices.watch",
  "dispatch",
  "extensions.list",
  "files.listDir",
  "files.searchPaths",
  "files.stat",
  "files.watch",
  "files.watchFile",
  "git.status",
  "git.watch",
  "harness.availability",
  "harness.commands",
  "harness.models",
  "harness.spinnerVerbs",
  "harness.watchAvailability",
  "hello",
  "host.resources.acquire",
  "host.resources.get",
  "host.resources.release",
  "host.restartPreview",
  "host.stats.watch",
  "hostAddress.names",
  "languages.availability",
  "languages.availability.watch",
  "languages.catalog",
  "languages.context.watch",
  "languages.discover",
  "languages.host.processBudget.get",
  "languages.host.state",
  "languages.host.state.watch",
  "languages.install.watch",
  "languages.log.watch",
  "languages.operation.get",
  "languages.preview.media",
  "languages.python.interpreters",
  "languages.sql.dialect.get",
  "languages.tree.operation.get",
  "languages.trust.get",
  "languages.trust.inspect",
  "origins.forCommit",
  "origins.match",
  "prediction.context",
  "prediction.managed.watch",
  "profiles.get",
  "profiles.watch",
  "relayRoute.status",
  "remoteAccess.status",
  "requests.curl.parse",
  "requests.send.get",
  "requests.sendLog.page",
  "requests.sendLog.watch",
  "requests.watch",
  "review.checkoutStatus",
  "review.reviewerSettings",
  "review.riskSummary",
  "review.verdicts",
  "review.watchRiskSummary",
  "session.acceptPlan",
  "session.terminalCommand",
  "session.turns",
  "sessions.autoArchive",
  "sessions.idleCompaction",
  "sessions.suggestedReplies",
  "sessions.visuals",
  "settings.list",
  "settings.describe",
  "settings.get",
  "shares.list",
  "shares.watchPresence",
  "simulator.sessionFeed",
  "simulator.watch",
  "subscribeHost",
  "subscribeSession",
  "terminal.attach",
  "terminal.attachBinary",
  "traces.compare",
  "traces.get",
  "traces.settings",
  "traces.span",
  "traces.watch",
  "usage.query",
  "usage.watch",
  "userAccess.watch",
  "voice.settings",
];

test("only the reviewed read-only RPCs are open without user access, and no Command is", () => {
  const open = Object.entries<UserAccessNeed>(USER_RPCS).flatMap(([tag, need]) =>
    need === "any" ? [tag] : []
  );

  const commands = Object.entries<UserAccessNeed>(USER_COMMANDS).flatMap(([tag, need]) =>
    need === "any" ? [tag] : []
  );

  expect(open.toSorted()).toEqual(READ_ONLY.toSorted());
  expect(commands).toEqual([]);
});

// What the security reviews found open (ENG-927): each wrote, deleted, installed or ran something.
test.each([
  "files.delete",
  "files.write",
  "terminal.open",
  "git.commit",
  "languages.context.acquire",
  "languages.context.configure",
  "constellation.base.export",
  "constellation.claim.export",
  "constellation.defaults.set",
  "simulator.boot",
  "simulator.restart",
  "attachments.clear",
  "attachments.setSettings",
  "data.source.remove",
  // A second review: these read file contents or credentials, or acted for the user.
  "hostAddress.open",
  "files.read",
  "files.readVersioned",
  "files.grep",
  "data.describe",
  "voice.transcribe",
  "presence.report",
  // They connect to an endpoint the caller names.
  "prediction.capability",
  "prediction.complete",
  "prediction.edit",
  // Contents again: a commit's files, its diff, its history and lines, and a message's images.
  "git.show",
  "git.diff",
  "git.log",
  "git.blame",
  "attachments.read",
])("%s is refused without user access and allowed with it", (rpc) => {
  expect(decideUserAccess(rpc, null, false)?.what).toBe(rpc);
  expect(decideUserAccess(rpc, null, true)).toBeNull();
});

test.each(["AcceptTurns", "StartSession", "SendTurn", "SetWorktreeSetup", "RegisterWorkspace"])(
  "dispatch %s is refused without user access",
  (command) => {
    expect(decideUserAccess("dispatch", command, false)?.what).toBe(`dispatch:${command}`);
  }
);
