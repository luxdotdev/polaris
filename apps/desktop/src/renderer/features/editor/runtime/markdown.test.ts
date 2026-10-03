import { expect, test } from "bun:test";
import {
  LanguageCheckout,
  HostId,
  HostInfo,
  Workspace,
  WorkspaceId,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { previewDocument } from "./markdown.ts";

const hostId = HostId.make("fake-host");

const workspaceId = WorkspaceId.make("ws");

const workspace = new Workspace({
  id: workspaceId,
  path: "/repo",
  name: "repo",
  isGitRepo: true,
  worktreeRoot: "/trees",
  hidden: false,
  registeredAt: "2026-10-02T00:00:00Z",
});

const tree = new Worktree({
  id: WorktreeId.make("tree"),
  workspaceId,
  path: "/trees/task",
  branch: "task",
  head: "abc",
  createdBySessionId: null,
  isMain: false,
});

const host: HostView = {
  key: "remote",
  label: "Remote",
  alias: "fake",
  colour: null,
  proofHarness: false,
  status: {
    state: "reconnecting",
    failure: null,
    attempt: 1,
    since: 0,
    nextAttemptAt: null,
    host: new HostInfo({
      hostId,
      hostname: "remote",
      platform: "linux-x64",
      homeDir: "/home/fake",
      daemonVersion: "fixture",
      startedAt: "2026-10-02T00:00:00Z",
    }),
    capabilities: [],
    epoch: 1,
    latencyMs: null,
    lastSeenAt: 0,
  },
};

const model = {
  ...emptyHostModel,
  workspaces: new Map([[workspaceId, workspace]]),
  worktrees: new Map([[tree.id, tree]]),
};

const app = { hosts: [host], hostModels: { remote: model } };

test("preview retains original Host and authoritative Worktree identity across reconnect", () => {
  const document = previewDocument(app, {
    hostKey: "remote",
    workspaceId,
    path: "/trees/task/docs/readme.md",
  });

  expect(document?.hostId).toBe(hostId);

  expect(document?.checkout).toEqual(
    LanguageCheckout.cases.Worktree.make({
      workspaceId,
      worktreeId: tree.id,
      path: tree.path,
    })
  );

  expect(
    previewDocument(app, { hostKey: "remote", workspaceId, path: "/repo/docs/a.md" })?.checkout
  ).toEqual(LanguageCheckout.cases.Workspace.make({ workspaceId, path: "/repo" }));
});

test("unknown Host, checkout and lexical sibling never acquire invented media authority", () => {
  expect(
    previewDocument(app, { hostKey: "other", workspaceId, path: "/repo/docs/a.md" })
  ).toBeNull();

  expect(
    previewDocument(app, { hostKey: "remote", workspaceId: "other", path: "/repo/docs/a.md" })
  ).toBeNull();

  expect(
    previewDocument(app, { hostKey: "remote", workspaceId, path: "/repo-sibling/a.md" })
  ).toBeNull();

  expect(
    previewDocument(app, { hostKey: "remote", workspaceId, path: "/unknown/a.md" })
  ).toBeNull();
});
