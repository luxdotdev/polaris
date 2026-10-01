import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PullRowView } from "../../shared/github.ts";
import { harness, signIn, until } from "./github.testing.ts";
import { GitHub } from "./index.ts";
import { pullDetail, pullSearch } from "./queries.ts";
import { withStacks } from "./stacks.ts";

const row = (number: number, base: string, head: string, patch: Partial<PullRowView> = {}) =>
  ({
    id: `PR_${number}`,
    number,
    title: `Pull ${number}`,
    url: "",
    repo: "acme/app",
    host: "github.com",
    isDraft: false,
    author: null,
    headRefName: head,
    headRefOid: "h",
    baseRefName: base,
    additions: number,
    deletions: 1,
    updatedAt: "",
    reviewDecision: null,
    viewerLatestReview: null,
    requestedReviewers: [],
    accountId: 1,
    workspaces: [],
    fromFork: false,
    checks: null,
    stack: null,
    ...patch,
  }) satisfies PullRowView;

const layers = (rows: ReadonlyArray<PullRowView>) =>
  withStacks(rows).map((r) =>
    r.stack === null || r.stack === undefined
      ? `#${r.number} -`
      : `#${r.number} ${r.stack.position}/${r.stack.size} on ${r.stack.trunk}`
  );

describe("inferring a stack from base and head branches", () => {
  test("a linear chain down to the first base that isn't a head", () => {
    expect(
      layers([row(3, "b", "c"), row(1, "main", "a"), row(2, "a", "b"), row(9, "main", "solo")])
    ).toEqual(["#3 3/3 on main", "#1 1/3 on main", "#2 2/3 on main", "#9 -"]);

    const [top] = withStacks([row(2, "a", "b"), row(1, "main", "a")]);

    expect(top?.stack?.members.map((m) => m.number)).toEqual([1, 2]);
    expect(top?.stack).toMatchObject({ source: "inferred", number: null });
  });

  test("forks, other repositories and GitHub's own stacks stay out", () => {
    expect(layers([row(1, "main", "a"), row(2, "a", "b", { fromFork: true })])).toEqual([
      "#1 -",
      "#2 -",
    ]);
    expect(layers([row(1, "main", "a"), row(2, "a", "b", { repo: "acme/other" })])).toEqual([
      "#1 -",
      "#2 -",
    ]);
  });

  test("a branch point or a cycle isn't a stack", () => {
    expect(layers([row(1, "main", "a"), row(2, "a", "b"), row(3, "a", "c")])).toEqual([
      "#1 -",
      "#2 -",
      "#3 -",
    ]);
    expect(layers([row(1, "b", "a"), row(2, "a", "b")])).toEqual(["#1 -", "#2 -"]);
  });

  test("Enterprise hosts never ask for stack fields", () => {
    const text = (request: { readonly query: string }) => request.query;

    expect(text(pullSearch({ q: "" }, true))).toContain("stackEntry");
    expect(text(pullSearch({ q: "" }, false))).not.toContain("stackEntry");
    expect(text(pullDetail({ owner: "o", name: "n", number: 1 }, false))).not.toContain("stack");
  });
});

const harnesses: Array<ReturnType<typeof harness>> = [];

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

describe("stacks on the fake", () => {
  test("GitHub's stack and an inferred one reach the list and the detail", async () => {
    const h = harness();

    harnesses.push(h);
    h.fake.seedStacks();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        yield* gh.watch([
          {
            workspace: { hostKey: "local", workspaceId: "w" },
            remotes: ["git@github.com:acme/infra.git"],
          },
        ]);

        const list = yield* until(gh.pulls, (v) =>
          v.requested.some((r) => r.number === 62 && r.stack !== null)
        );

        const by = (repo: string, number: number) =>
          list.requested.find((r) => r.repo === repo && r.number === number);

        const github = by("acme/platform", 62);

        expect(github?.stack).toMatchObject({
          source: "github",
          number: 635,
          trunk: "nightly",
          position: 2,
          size: 4,
        });
        expect(github?.stack?.members.map((m) => [m.number, m.status, m.checks?.state])).toEqual([
          [61, "open", "success"],
          [62, "open", "success"],
          [63, "open", "pending"],
          [64, "draft", "failure"],
        ]);
        expect(github?.checks).toEqual({ state: "success", total: 4 });

        expect(by("acme/infra", 12)?.stack).toMatchObject({
          source: "inferred",
          position: 2,
          size: 2,
          trunk: "main",
        });
        expect(by("acme/infra", 13)?.stack ?? null).toBeNull();

        const detail = yield* gh.detail({ repo: { owner: "acme", name: "platform" }, number: 62 });

        expect(detail.stack?.number).toBe(635);
        expect(detail.baseRefName).toBe(github?.stack?.members[0]?.headRefName ?? "none");

        const inferred = yield* gh.detail({ repo: { owner: "acme", name: "infra" }, number: 12 });

        expect(inferred.stack).toMatchObject({ source: "inferred", position: 2 });
      })
    );
  });
});
