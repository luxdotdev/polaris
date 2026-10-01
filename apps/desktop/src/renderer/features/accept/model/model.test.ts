import { describe, expect, test } from "bun:test";
import { AcceptBranch, SessionId, TurnId } from "@polaris/protocol";
import type { PullDetailView, ReviewThreadView } from "../../../../shared/github.ts";
import { acceptEnd, headerAction, turnsLabel } from "./action.ts";
import { type AcceptPorts, type AcceptRequest, runAccept, stepsOf } from "./flow.ts";
import { pullFeedback, unsentThreads } from "./pullComments.ts";
import { toArchive } from "./linked.ts";

const turn = (index: number) => ({ id: `t${index}`, index });

describe("the header action", () => {
  test("names the Turns, pauses on a Critical finding, waits for a working Turn", () => {
    const pending = [turn(21), turn(22), turn(23)];
    const base = { pending, critical: 0, working: false, pullNumber: null };

    expect(turnsLabel([turn(23)])).toBe("turn 24");
    expect(headerAction(base)).toEqual({ kind: "accept", label: "Accept turns 22–24" });
    expect(headerAction({ ...base, critical: 1 })).toEqual({
      kind: "paused",
      label: "Accept paused · 1 critical",
      critical: 1,
    });
    expect(headerAction({ ...base, working: true }).kind).toBe("working");
  });

  test("with nothing to accept, shows the linked pull request or nothing", () => {
    const none = { pending: [], critical: 0, working: false, pullNumber: null };

    expect(headerAction(none)).toEqual({ kind: "none" });
    expect(headerAction({ ...none, pullNumber: 12 })).toMatchObject({
      kind: "linked",
      label: "Pull request #12",
    });
  });
});

describe("where accepting ends", () => {
  const remote = { url: "git@github.com:acme/widgets.git" };
  const repo = { owner: "acme", name: "widgets" };

  const input = {
    remote,
    repo,
    choice: { kind: "create", name: "polaris/x" } as const,
    current: "main",
    defaultBranch: "main",
    linked: false,
  };

  test("a new branch on GitHub opens a pull request", () => {
    expect(acceptEnd(input)).toBe("pull");
  });

  test("committing onto the default branch, another code host, or a linked session pushes", () => {
    expect(acceptEnd({ ...input, choice: { kind: "current" } })).toBe("push");
    expect(acceptEnd({ ...input, repo: null })).toBe("push");
    expect(acceptEnd({ ...input, linked: true })).toBe("push");
  });

  test("no remote commits only", () => {
    expect(acceptEnd({ ...input, remote: null })).toBe("commit");
  });
});

const request = (patch: Partial<AcceptRequest> = {}): AcceptRequest => ({
  sessionId: SessionId.make("s1"),
  throughTurnId: TurnId.make("t2"),
  revertLaterTurns: false,
  branch: AcceptBranch.cases.Create.make({ name: "polaris/x" }),
  granularity: "single",
  title: "Add things",
  body: "",
  turnTitles: [],
  push: true,
  pull: {
    repo: { owner: "acme", name: "widgets" },
    workspace: { hostKey: "local", workspaceId: "w1" },
    title: "Add things",
    body: "",
    draft: false,
  },
  ...patch,
});

const ok = <A>(value: A) => Promise.resolve({ ok: true as const, value });

const ports = (calls: Array<string>, failPush = false): AcceptPorts => ({
  accept: () => {
    calls.push("accept");

    return ok(null);
  },
  commit: () => {
    calls.push("commit");

    return ok({ branch: "polaris/x", base: "main", commits: ["c1"] });
  },
  push: (_, branch) => {
    calls.push(`push ${branch}`);

    return failPush
      ? Promise.resolve({ ok: false, error: { code: "AcceptRefused", message: "rejected" } })
      : ok(null);
  },
  openPull: (_, head, base) => {
    calls.push(`pull ${head}→${base}`);

    return ok({ number: 7, url: "u" });
  },
  link: (_, __, pull) => {
    calls.push(`link #${pull.number}`);

    return ok(null);
  },
});

describe("running an accept", () => {
  test("accepts, commits, pushes, opens the pull request and links it", async () => {
    const calls: Array<string> = [];
    const steps: Array<string> = [];
    const outcome = await runAccept(request(), ports(calls), (s) => steps.push(s));

    expect(calls).toEqual(["accept", "commit", "push polaris/x", "pull polaris/x→main", "link #7"]);
    expect(steps).toEqual(["accept", "commit", "push", "pull", "link"]);
    expect(outcome).toMatchObject({ ok: true, progress: { pull: { number: 7 } } });
  });

  test("a failed push stops there and a retry resumes from it", async () => {
    const calls: Array<string> = [];
    const failed = await runAccept(request(), ports(calls, true), () => {});

    expect(failed).toMatchObject({ ok: false, step: "push", message: "rejected" });

    if (failed.ok) return;

    const retried: Array<string> = [];
    const outcome = await runAccept(request(), ports(retried), () => {}, failed.progress);

    expect(retried).toEqual(["push polaris/x", "pull polaris/x→main", "link #7"]);
    expect(outcome.ok).toBe(true);
  });

  test("without a remote it only accepts and commits; onto the default branch, no pull request", async () => {
    expect(stepsOf(request({ push: false, pull: null }))).toEqual(["accept", "commit"]);

    const calls: Array<string> = [];

    const noBase: AcceptPorts = {
      ...ports(calls),
      commit: () => ok({ branch: "main", base: null, commits: ["c1"] }),
    };

    const outcome = await runAccept(request(), noBase, () => {});

    expect(calls).toEqual(["accept", "push main"]);
    expect(outcome).toMatchObject({ ok: true, progress: { pull: null } });
  });
});

const thread = (id: string, patch: Partial<ReviewThreadView> = {}): ReviewThreadView => ({
  id,
  path: "src/a.ts",
  isResolved: false,
  isOutdated: false,
  anchor: { kind: "line", line: 12, startLine: 10, side: "right", startSide: "right" },
  comments: [
    { id: `${id}-c1`, author: "mona", body: "Rename this", createdAt: "", url: "", pending: false },
  ],
  ...patch,
});

const detail = (threads: ReadonlyArray<ReviewThreadView>): PullDetailView => ({
  id: "PR_1",
  number: 12,
  title: "",
  body: "",
  url: "",
  repo: "acme/widgets",
  state: "open",
  isDraft: false,
  author: null,
  viewerLogin: "lucas",
  viewerCanApprove: false,
  headRefName: "polaris/x",
  headRefOid: "",
  baseRefName: "main",
  baseRefOid: "",
  commits: 1,
  files: [],
  threads,
  pendingReview: null,
  accountId: 1,
});

describe("review comments as the next Turn", () => {
  test("unresolved threads become feedback comments; sent ones go again only when added to", () => {
    const pr = detail([thread("a"), thread("b", { isResolved: true })]);
    const first = pullFeedback(pr, {});

    expect(first?.batch.comments).toHaveLength(1);
    expect(first?.batch.comments[0]).toMatchObject({
      path: "src/a.ts",
      lines: { start: 10, end: 12, side: "new" },
      note: "mona: Rename this",
    });
    expect(pullFeedback(pr, first!.sent)).toBeNull();

    const replied = thread("a", {
      comments: [
        ...thread("a").comments,
        { id: "a-c2", author: "mona", body: "Still?", createdAt: "", url: "", pending: false },
      ],
    });

    expect(unsentThreads(detail([replied]), first!.sent)).toHaveLength(1);
  });
});

describe("archiving on merge or close", () => {
  test("archives a linked session once, when its pull request merged or closed", () => {
    const linked = [
      {
        key: "session:h:s1",
        hostKey: "h",
        sessionId: "s1",
        pull: { repo: { owner: "a", name: "b" }, number: 1 },
      },
      {
        key: "session:h:s2",
        hostKey: "h",
        sessionId: "s2",
        pull: { repo: { owner: "a", name: "b" }, number: 2 },
      },
    ];

    const states = [
      {
        key: "session:h:s1",
        pullId: "P1",
        state: "merged" as const,
        headRefOid: null,
        closedAt: "x",
      },
      {
        key: "session:h:s2",
        pullId: "P2",
        state: "open" as const,
        headRefOid: null,
        closedAt: null,
      },
    ];

    expect(toArchive(states, linked, new Set()).map((l) => l.sessionId)).toEqual(["s1"]);
    expect(toArchive(states, linked, new Set(["session:h:s1"]))).toEqual([]);
  });
});
