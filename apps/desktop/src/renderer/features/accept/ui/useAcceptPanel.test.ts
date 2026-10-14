import "../../../test/dom.testing.ts";
import type { AcceptDraft, AcceptPlan, SessionId, TurnId } from "@polaris/protocol";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Result } from "../../../../shared/api.ts";
import type { RepoAccessView } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import type { Plain } from "../../../store/plain.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { pullList } from "../../../test/github.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { pullsStore } from "../../pulls/store.ts";
import { branchFromPrompt } from "../../session/model/newSession.ts";
import { settingsStore } from "../../settings/store.ts";
import { type PanelSession, useAcceptPanel } from "./useAcceptPanel.ts";

// SAFETY: Turn ids are branded strings the Host chose; these name the plan's Turns.
const turn = (id: string) => id as TurnId;

let sessions = 0;

/** Runs are kept per session and Turn for the app's life, so each test takes a new session. */
const newSession = (patch: Partial<PanelSession> = {}): PanelSession => {
  sessions += 1;

  return {
    hostKey: "h1",
    // SAFETY: session ids are branded strings; any unique one names a session here.
    sessionId: `s${sessions}` as SessionId,
    workspaceId: "w1",
    title: "Serve on one port",
    linked: false,
    ...patch,
  };
};

const plan = (patch: Partial<Plain<AcceptPlan>> = {}): Plain<AcceptPlan> => ({
  // SAFETY: the panel never reads the plan's own session id.
  sessionId: "s" as SessionId,
  root: "/repo",
  turns: [{ turnId: turn("t1"), index: 0, title: "Serve", files: 2 }],
  laterTurns: 0,
  branch: "main",
  defaultBranch: "main",
  worktree: false,
  remote: { name: "origin", url: "git@github.com:acme/atlas.git" },
  files: 2,
  additions: 10,
  deletions: 1,
  ...patch,
});

const draft: Plain<AcceptDraft> = {
  title: "Serve on one port",
  body: "Both listeners share one.",
  prTitle: "",
  prBody: "Closes #3",
  turnTitles: ["Serve"],
  source: "template",
  note: null,
};

const access = (state: RepoAccessView["state"]): RepoAccessView => ({
  repo: "acme/atlas",
  state,
  accountId: 1,
  login: "mona",
  permission: "WRITE",
  approvalUrl: null,
  ssoUrl: null,
  workspaces: [],
});

const withRepos = (repos: ReadonlyArray<RepoAccessView>) =>
  pullsStore.setState({ list: pullList([], repos) });

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeBridge();
  bridge.answerOk("session.acceptPlan", plan());
  bridge.answerOk("session.draftAccept", draft);
  bridge.answerOk("session.commitAccepted", {
    branch: "polaris/serve",
    commits: ["c1"],
    base: "main",
  });
  bridge.answerOk("session.pushAccepted", {
    remote: { name: "origin", url: "git@github.com:acme/atlas.git" },
    branch: "polaris/serve",
  });
  bridge.answerOk("github.pull.create", { id: "PR_9", number: 9, url: "https://pr/9" });
  withRepos([access("ok")]);
});

afterEach(() => {
  cleanup();
  standInBridge(null);
  settingsStore.setState(settingsStore.getInitialState());
  pullsStore.setState(pullsStore.getInitialState());
});

const ready = async (session: PanelSession, through = turn("t1")) => {
  const hook = renderHook(({ id }) => useAcceptPanel(session, id), {
    initialProps: { id: through },
  });

  await waitFor(() => expect(hook.result.current.fields).not.toBeNull());
  await waitFor(() => expect(hook.result.current.plan.kind).toBe("ready"));

  return hook;
};

const submit = (hook: Awaited<ReturnType<typeof ready>>) => act(() => hook.result.current.submit());

describe("loading", () => {
  test("asks the session's Host for the plan and the draft through the chosen Turn", async () => {
    const session = newSession();
    const { result } = await ready(session);

    const asked = { hostKey: "h1", sessionId: session.sessionId, throughTurnId: turn("t1") };

    expect(bridge.sent("session.acceptPlan")).toEqual([asked]);
    expect(bridge.sent("session.draftAccept")).toEqual([asked]);
    expect(result.current.fields).toEqual({
      title: "Serve on one port",
      body: "Both listeners share one.",
      prTitle: "",
      prBody: "Closes #3",
      turnTitles: ["Serve"],
    });
  });

  test("a refused plan shows its reason", async () => {
    bridge.refuse("session.acceptPlan", { code: "NotConnected", message: "Host is offline" });

    const session = newSession();
    const { result } = renderHook(() => useAcceptPanel(session, turn("t1")));

    await waitFor(() =>
      expect(result.current.plan).toEqual({ kind: "failed", message: "Host is offline" })
    );
    expect(result.current.canSubmit).toBe(false);
  });

  test("an answer for a Turn no longer chosen is never shown", async () => {
    const answers: Array<(r: Result<Plain<AcceptPlan>>) => void> = [];

    bridge.answer("session.acceptPlan", () => new Promise((resolve) => answers.push(resolve)));

    const session = newSession();

    const hook = renderHook(({ id }) => useAcceptPanel(session, id), {
      initialProps: { id: turn("t1") },
    });

    hook.rerender({ id: turn("t2") });
    await act(async () => answers[0]?.({ ok: true, value: plan({ laterTurns: 5 }) }));

    expect(hook.result.current.plan.kind).toBe("loading");

    await act(async () => answers[1]?.({ ok: true, value: plan({ laterTurns: 0 }) }));

    expect(hook.result.current.plan).toMatchObject({ kind: "ready", value: { laterTurns: 0 } });
  });

  test("an older answer arriving after the newer one doesn't replace it", async () => {
    const answers: Array<(r: Result<Plain<AcceptPlan>>) => void> = [];

    bridge.answer("session.acceptPlan", () => new Promise((resolve) => answers.push(resolve)));

    const session = newSession();

    const hook = renderHook(({ id }) => useAcceptPanel(session, id), {
      initialProps: { id: turn("t1") },
    });

    hook.rerender({ id: turn("t2") });
    await act(async () => answers[1]?.({ ok: true, value: plan({ laterTurns: 0 }) }));
    await act(async () => answers[0]?.({ ok: true, value: plan({ laterTurns: 5 }) }));

    expect(hook.result.current.plan).toMatchObject({ kind: "ready", value: { laterTurns: 0 } });
  });

  test("edits belong to the Turn they were made for", async () => {
    const hook = await ready(newSession());

    act(() => {
      hook.result.current.setFields({ title: "My title" });
    });
    expect(hook.result.current.fields?.title).toBe("My title");

    hook.rerender({ id: turn("t2") });
    await waitFor(() => expect(hook.result.current.fields?.title).toBe("Serve on one port"));
  });
});

describe("the branch and where accepting ends", () => {
  test("on the default branch it commits to a new branch named with Settings' prefix", async () => {
    settingsStore.setState((s) => ({ sessions: { ...s.sessions, branchPrefix: "lucas/" } }));
    const session = newSession();
    const { result } = await ready(session);

    expect(result.current.choice).toEqual({
      kind: "create",
      name: branchFromPrompt(session.title, session.sessionId, "lucas/"),
    });
  });

  test("a session in its own Worktree keeps the Worktree's branch, whatever the user picked", async () => {
    bridge.answerOk("session.acceptPlan", plan({ worktree: true, branch: "polaris/wt" }));
    const { result } = await ready(newSession());

    act(() => result.current.setChoice({ kind: "create", name: "other" }));

    expect(result.current.choice).toEqual({ kind: "current" });
  });

  test.each([
    { name: "a GitHub remote the account can reach", patch: {}, repos: ["ok"], end: "pull" },
    {
      name: "a GitHub remote the account is blocked from",
      patch: {},
      repos: ["blocked"],
      end: "push",
    },
    {
      name: "another code host",
      patch: { remote: { name: "origin", url: "git@gitlab.example:acme/atlas.git" } },
      repos: [],
      end: "push",
    },
    { name: "no remote", patch: { remote: null }, repos: [], end: "commit" },
  ] as const)("$name ends in $end", async ({ patch, repos, end }) => {
    bridge.answerOk("session.acceptPlan", plan(patch));
    withRepos(repos.map(access));
    const { result } = await ready(newSession());

    expect(result.current.end).toBe(end);
  });

  test("a session that already has a pull request only pushes", async () => {
    const { result } = await ready(newSession({ linked: true }));

    expect(result.current.end).toBe("push");
  });
});

describe("submitting", () => {
  test("accepts, commits, pushes, opens the pull request and links it, in that order", async () => {
    const session = newSession();
    const hook = await ready(session);

    await submit(hook);

    expect(bridge.methods()).toEqual([
      "session.acceptPlan",
      "session.draftAccept",
      "dispatch",
      "session.commitAccepted",
      "session.pushAccepted",
      "github.pull.create",
      "dispatch",
    ]);
    expect(bridge.sent("github.pull.create")).toEqual([
      {
        repo: { owner: "acme", name: "atlas" },
        head: "polaris/serve",
        base: "main",
        title: "Serve on one port",
        body: "Closes #3",
        draft: false,
        workspace: { hostKey: "h1", workspaceId: "w1" },
      },
    ]);
    expect(bridge.sent("dispatch")[0]?.command).toEqual(
      Commands.AcceptTurns({
        sessionId: session.sessionId,
        throughTurnId: turn("t1"),
        revertLaterTurns: false,
      })
    );
    expect(hook.result.current.run).toMatchObject({
      kind: "done",
      progress: { pull: { number: 9 } },
    });
  });

  test("one commit per Turn and reverting later Turns only apply when there are such Turns", async () => {
    const hook = await ready(newSession());

    act(() => {
      hook.result.current.setPerTurn(true);
      hook.result.current.setRevertLater(true);
    });
    await submit(hook);

    expect(bridge.sent("session.commitAccepted")[0]?.granularity).toBe("single");
    expect(bridge.sent("dispatch")[0]?.command).toMatchObject({ revertLaterTurns: false });
  });

  test("with two Turns and later ones, both choices go through", async () => {
    bridge.answerOk(
      "session.acceptPlan",
      plan({
        laterTurns: 1,
        turns: [
          { turnId: turn("t1"), index: 0, title: "Serve", files: 1 },
          { turnId: turn("t2"), index: 1, title: "Tidy", files: 1 },
        ],
      })
    );
    const hook = await ready(newSession());

    act(() => {
      hook.result.current.setPerTurn(true);
      hook.result.current.setRevertLater(true);
    });
    await submit(hook);

    expect(bridge.sent("session.commitAccepted")[0]?.granularity).toBe("per-turn");
    expect(bridge.sent("dispatch")[0]?.command).toMatchObject({ revertLaterTurns: true });
  });

  test("a failed push stops the run; trying again resumes at the push", async () => {
    bridge.refuse("session.pushAccepted", {
      code: "GitError",
      message: "rejected: non-fast-forward",
    });
    const hook = await ready(newSession());

    await submit(hook);

    expect(hook.result.current.run).toMatchObject({
      kind: "failed",
      step: "push",
      message: "rejected: non-fast-forward",
    });

    bridge.answerOk("session.pushAccepted", {
      remote: { name: "origin", url: "git@github.com:acme/atlas.git" },
      branch: "polaris/serve",
    });
    await submit(hook);

    expect(bridge.sent("session.commitAccepted")).toHaveLength(1);
    expect(bridge.sent("session.pushAccepted")).toHaveLength(2);
    expect(hook.result.current.run.kind).toBe("done");
  });

  test("a blank title can't be submitted", async () => {
    const hook = await ready(newSession());

    act(() => {
      hook.result.current.setFields({ title: "   " });
    });

    expect(hook.result.current.canSubmit).toBe(false);
  });
});
