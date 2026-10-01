import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PullListView } from "../../shared/github.ts";
import { harness, signIn, until } from "./github.testing.ts";
import { GitHub, type WorkspaceRemotes } from "./index.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

const open = (options: Parameters<typeof harness>[0] = {}) => {
  const h = harness(options);

  harnesses.push(h);

  return h;
};

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

const WORKSPACES: ReadonlyArray<WorkspaceRemotes> = [
  {
    workspace: { hostKey: "local", workspaceId: "w1" },
    remotes: ["git@github.com:acme/widgets.git"],
  },
  { workspace: { hostKey: "pi", workspaceId: "w2" }, remotes: ["https://github.com/acme/widgets"] },
  {
    workspace: { hostKey: "local", workspaceId: "w3" },
    remotes: ["https://github.com/mona/dotfiles.git"],
  },
  {
    workspace: { hostKey: "local", workspaceId: "w4" },
    remotes: ["ssh://git@github.com/lockedorg/vault.git"],
  },
  {
    workspace: { hostKey: "local", workspaceId: "w5" },
    remotes: ["git@gitlab.com:someone/else.git"],
  },
];

const numbers = (rows: PullListView["requested"]) => rows.map((r) => `${r.repo}#${r.number}`);

const searches = (h: ReturnType<typeof harness>) =>
  h.fake.requests.filter((r) => r.name === "PullSearch").length;

/** Signs mona in, watches the Workspaces and waits for the first full list. */
const firstList = (h: ReturnType<typeof harness>) =>
  Effect.gen(function* () {
    const gh = yield* GitHub;

    yield* signIn(h, "mona");
    yield* gh.watch(WORKSPACES);

    return yield* until(
      gh.pulls,
      (v) =>
        v.repos.length === 3 && v.repos.every((r) => r.state !== "checking") && v.updatedAt !== null
    );
  });

describe("the pull request list", () => {
  test("groups review requested, mine and other open, matched to Workspaces", async () => {
    const h = open();
    const list = await h.run(firstList(h));

    expect(numbers(list.requested)).toEqual(["acme/widgets#42", "mona/dotfiles#7"]);
    expect(numbers(list.mine)).toEqual(["acme/widgets#43"]);
    expect(numbers(list.other)).toEqual(["acme/widgets#44"]);
    expect(list.requested[0]?.workspaces).toEqual([
      { hostKey: "local", workspaceId: "w1" },
      { hostKey: "pi", workspaceId: "w2" },
    ]);
    expect(list.mine[0]).toMatchObject({ isDraft: true, reviewDecision: "review-required" });
    expect(list.polling).toBe("focused");
  });

  test("an org that restricts OAuth Apps shows as blocked, with where to ask", async () => {
    const h = open();
    const list = await h.run(firstList(h));
    const vault = list.repos.find((r) => r.repo === "lockedorg/vault");

    expect(vault).toMatchObject({
      state: "blocked",
      login: "mona",
      approvalUrl: "https://github.test/settings/connections/applications/Ov23lix8h2ldBZFwXqek",
      ssoUrl: "https://github.test/orgs/lockedorg/sso",
    });
    expect(list.repos.find((r) => r.repo === "acme/widgets")).toMatchObject({
      state: "ok",
      permission: "WRITE",
    });
  });

  test("a quiet poll costs only 304s: no searches until something changes", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const first = yield* firstList(h);
        const before = searches(h);

        yield* h.advance(60_000);
        yield* until(gh.pulls, (v) => (v.updatedAt ?? 0) > (first.updatedAt ?? 0));
        expect(searches(h)).toBe(before);
        expect(h.fake.requests.filter((r) => r.kind === "rest" && r.status === 304).length).toBe(2);

        h.fake.requestReview("acme/widgets", 44, "mona");
        yield* h.advance(60_000);

        const changed = yield* until(gh.pulls, (v) => v.requested.length === 3);

        expect(numbers(changed.other)).toEqual([]);
        expect(searches(h)).toBe(before + 3);
      })
    );
  });

  test("polls every five minutes while no window is focused", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* firstList(h);
        yield* gh.setFocused(false);

        const count = h.fake.requests.length;

        yield* h.advance(60_000);
        yield* Effect.yieldNow;
        expect(h.fake.requests.length).toBe(count);
        yield* h.advance(240_000);
        yield* until(gh.pulls, (v) => v.polling === "background");
      })
    );
  });

  test("stops searching once Polaris has spent its share of the limit", async () => {
    const h = open({ policy: { share: 0.0001, reserve: 0 } });

    const list = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        yield* gh.watch(WORKSPACES);

        return yield* until(gh.pulls, (v) => v.polling === "throttled");
      })
    );

    expect(list.throttledUntil).toBeGreaterThan(0);
    expect(searches(h)).toBe(0);
  });

  test("without an account every watched repository says so", async () => {
    const h = open();

    const list = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* gh.watch(WORKSPACES);

        return yield* until(gh.pulls, (v) => v.repos.length === 3);
      })
    );

    expect(list.repos.map((r) => r.state)).toEqual(["no-account", "no-account", "no-account"]);
    expect(list.polling).toBe("idle");
  });
});

describe("routing repositories to accounts", () => {
  test("the first account that can see a repository wins", async () => {
    const h = open();

    const list = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "hubot");
        yield* signIn(h, "mona");
        yield* gh.watch([
          {
            workspace: { hostKey: "local", workspaceId: "w1" },
            remotes: ["git@github.com:mona/dotfiles.git"],
          },
          {
            workspace: { hostKey: "local", workspaceId: "w2" },
            remotes: ["git@github.com:hubot/scripts.git"],
          },
        ]);

        return yield* until(
          gh.pulls,
          (v) => v.repos.length === 2 && v.repos.every((r) => r.state === "ok")
        );
      })
    );

    expect(list.repos.map((r) => [r.repo, r.login])).toEqual([
      ["mona/dotfiles", "mona"],
      ["hubot/scripts", "hubot"],
    ]);
    // Requests anywhere count, not only in watched repositories: hubot is asked on acme#43.
    expect(numbers(list.requested).toSorted()).toEqual([
      "acme/widgets#42",
      "acme/widgets#43",
      "hubot/scripts#3",
      "mona/dotfiles#7",
    ]);
  });

  test("an owner mapping, then a Workspace override, choose the account", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const acme = (v: PullListView) => v.repos.find((r) => r.repo === "acme/widgets");

        yield* signIn(h, "mona");
        yield* signIn(h, "hubot");
        yield* gh.watch(WORKSPACES.slice(0, 1));
        yield* until(gh.pulls, (v) => acme(v)?.login === "mona");

        yield* gh.setOwner("acme", 2002);
        yield* until(gh.pulls, (v) => acme(v)?.login === "hubot" && acme(v)?.permission === "READ");

        yield* gh.setWorkspace({ hostKey: "local", workspaceId: "w1" }, 1001);
        yield* until(gh.pulls, (v) => acme(v)?.login === "mona");
      })
    );
  });
});
