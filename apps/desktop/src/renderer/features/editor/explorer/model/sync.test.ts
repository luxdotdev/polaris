import { describe, expect, test } from "bun:test";
import type { ConnectionState, GitSyncAction } from "@polaris/protocol";
import { IDLE_RUN, type SyncFacts, type SyncFailure, type SyncRun, syncView } from "./sync.ts";

const tracked = { upstream: "origin/main", gone: false, remote: null };

const facts = (over: Partial<SyncFacts> = {}): SyncFacts => ({
  branch: "main",
  head: "8e41d07c",
  ahead: 0,
  behind: 0,
  tracking: tracked,
  ...over,
});

const view = (f: SyncFacts, run: SyncRun = IDLE_RUN, connection: ConnectionState = "connected") =>
  syncView({ facts: f, run, host: "Linux VM", connection });

const enabled = (f: SyncFacts, run?: SyncRun, connection?: ConnectionState) =>
  view(f, run, connection)
    ?.menu.filter((item) => item.enabled)
    .map((item) => item.action);

describe("syncView: the one button follows the branch's standing", () => {
  test.each([
    ["up to date", facts(), "up-to-date", "sync", "Pull anything new from origin/main"],
    ["behind", facts({ behind: 2 }), "behind", "pull", "Pull 2 commits from origin/main"],
    ["ahead", facts({ ahead: 1 }), "ahead", "push", "Push 1 commit to origin/main"],
    [
      "diverged",
      facts({ ahead: 3, behind: 2 }),
      "diverged",
      "sync",
      "Pull 2 commits from origin/main, then push 3 commits",
    ],
    [
      "no upstream",
      facts({ branch: "feature", tracking: { upstream: null, gone: false, remote: "origin" } }),
      "unpublished",
      "publish",
      "Push feature to origin",
    ],
    [
      "upstream gone",
      facts({
        branch: "feature",
        tracking: { upstream: "origin/feature", gone: true, remote: "origin" },
      }),
      "unpublished",
      "publish",
      "Push feature to origin",
    ],
  ] as const)("%s", (_, f, standing, action, hint) => {
    const v = view(f);

    expect(v?.standing).toBe(standing);
    expect(v?.primary).toMatchObject({ action, hint });
  });

  test.each([
    ["detached", facts({ branch: null }), "Check out a branch to pull or push."],
    [
      "no remote",
      facts({ tracking: { upstream: null, gone: false, remote: null } }),
      "No remote · add one with git remote add",
    ],
  ])("%s offers no sync, only a note", (_, f, note) => {
    const v = view(f);

    expect(v?.primary).toBeNull();
    expect(v?.note).toBe(note);
  });

  test("a branch with no commit yet can't be published", () => {
    const v = view(
      facts({ head: null, tracking: { upstream: null, gone: false, remote: "origin" } })
    );

    expect(v?.primary).toBeNull();
    expect(
      enabled(facts({ head: null, tracking: { upstream: null, gone: false, remote: "origin" } }))
    ).toEqual(["fetch"]);
  });

  test("a Daemon without git.sync reports no tracking, so there are no controls", () => {
    expect(view(facts({ tracking: null }))).toBeNull();
  });
});

describe("syncView: the menu", () => {
  test.each([
    ["tracked", facts(), ["fetch", "pull", "push"]],
    [
      "unpublished",
      facts({ tracking: { upstream: null, gone: false, remote: "origin" } }),
      ["fetch", "publish"],
    ],
    ["detached", facts({ branch: null }), ["fetch"]],
    ["no remote", facts({ tracking: { upstream: null, gone: false, remote: null } }), []],
  ] as const)("%s enables %p", (_, f, actions) => {
    expect(enabled(f)).toEqual([...actions]);
  });

  const running: SyncRun = {
    kind: "running",
    action: "pull",
    step: "pull",
    remote: "origin",
    startedAt: 0,
  };

  test.each([
    ["while a sync runs", running, "connected"],
    ["while the Host reconnects", IDLE_RUN, "reconnecting"],
    ["while the Host is offline", IDLE_RUN, "offline"],
  ] as const)("everything is off %s", (_, run, connection) => {
    expect(enabled(facts({ behind: 1 }), run, connection)).toEqual([]);
  });

  test("a Host away keeps the last counts and says why the controls are off", () => {
    const v = view(facts({ behind: 4, ahead: 1 }), IDLE_RUN, "reconnecting");

    expect(v).toMatchObject({ behind: 4, ahead: 1, away: "Reconnecting to Linux VM" });
    expect(view(facts(), IDLE_RUN, "offline")?.away).toBe("Linux VM is offline");
  });

  test("a running sync says which step and remote, then the action alone before the first step", () => {
    expect(view(facts(), running)?.running?.label).toBe("Pulling from origin");
    expect(
      view(facts(), { ...running, step: null, remote: null, action: "publish" })?.running?.label
    ).toBe("Publishing…");
  });
});

describe("syncView: a failure says what happened and offers the next step", () => {
  const failed = (reason: SyncFailure, action: GitSyncAction = "sync"): SyncRun => ({
    kind: "failed",
    action,
    reason,
    exitCode: 1,
    output: "git's words",
  });

  test.each([
    ["rejected", "push", "Push rejected", { kind: "action", action: "pull", label: "Pull" }],
    ["diverged", "sync", "Can't fast-forward", { kind: "terminal", label: "Open terminal" }],
    ["conflicts", "pull", "Pull stopped on conflicts", { kind: "changes", label: "Show changes" }],
    [
      "local-changes",
      "pull",
      "Local changes in the way",
      { kind: "changes", label: "Show changes" },
    ],
    ["auth", "fetch", "Couldn't sign in to origin", { kind: "terminal", label: "Open terminal" }],
    [
      "network",
      "fetch",
      "Couldn't reach origin",
      { kind: "action", action: "fetch", label: "Try again" },
    ],
    ["timeout", "push", "Push timed out", { kind: "action", action: "push", label: "Try again" }],
    ["lost", "pull", "Lost Linux VM", { kind: "action", action: "pull", label: "Try again" }],
    [
      "no-upstream",
      "push",
      "No upstream",
      { kind: "action", action: "publish", label: "Publish branch" },
    ],
    [
      "failed",
      "pull",
      "Pull failed (exit 1)",
      { kind: "action", action: "pull", label: "Try again" },
    ],
  ] as const)("%s", (reason, action, headline, next) => {
    const failure = view(facts({ ahead: 1, behind: 1 }), failed(reason, action))?.failure;

    expect(failure).toMatchObject({ headline, next, output: "git's words" });
  });

  test("auth names the Host whose credentials are missing", () => {
    expect(view(facts(), failed("auth"))?.failure?.detail).toContain(
      "Linux VM has no credentials for origin"
    );
  });
});
