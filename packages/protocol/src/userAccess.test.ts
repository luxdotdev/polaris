import { expect, test } from "bun:test";
import { decideUserAccess } from "./userAccess.ts";

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

// What runs a program or writes the Host's files: a socket-only process must have none of it.
test.each([
  "files.write",
  "files.create",
  "files.delete",
  "files.rename",
  "terminal.open",
  "terminal.input",
  "git.stage",
  "git.unstage",
  "git.discard",
  "git.commit",
  "git.init",
  "git.sync",
  "languages.install",
  "languages.python.select",
  "languages.format",
  "languages.format.project",
  "languages.edit.decide",
  "languages.tree.edit.decide",
  "languages.operation.recover",
  "languages.tree.operation.recover",
  "languages.trust.set",
  "prediction.managed",
  "traces.setSettings",
  "traces.installSkill",
  "review.setReviewerSettings",
  "constellation.dispatch",
  "constellation.worker.start",
  "constellation.worker.prepare",
  "constellation.worktree.prepare",
  "constellation.repository.prepare",
  "constellation.bundle.import",
  "constellation.base.import",
  "constellation.origin.import",
])("%s is refused without user access and allowed with it", (rpc) => {
  expect(decideUserAccess(rpc, null, false)?.what).toBe(rpc);
  expect(decideUserAccess(rpc, null, true)).toBeNull();
});

test.each([
  "StartSession",
  "ForkSession",
  "SendTurn",
  "RunShellCommand",
  "SetWorktreeSetup",
  "SetModel",
  "SetPermissionMode",
  "OpenReviewCheckout",
  "UpdateReviewCheckout",
  "RemoveReviewCheckout",
])("dispatch %s is refused without user access", (command) => {
  expect(decideUserAccess("dispatch", command, false)?.what).toBe(`dispatch:${command}`);
});
