import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { PullRef } from "../../shared/github.ts";
import { GitHub } from "./index.ts";
import { harness, signIn, until } from "./github.testing.ts";

const all: Array<ReturnType<typeof harness>> = [];

const open = () => {
  const h = harness();
  h.fake.seedOverview();
  all.push(h);

  return h;
};

const pull: PullRef = { repo: { owner: "acme", name: "widgets" }, number: 42 };

const mine: PullRef = { ...pull, number: 43 };

afterEach(() => {
  for (const h of all.splice(0)) h.cleanup();
});

describe("Overview data and actions", () => {
  test("pins Suzuka, includes inline bots, reviews, commits and timed checks; detail calls share the cache", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        yield* signIn(h, "mona");
        const gh = yield* GitHub;
        const detail = yield* gh.detail(pull);
        expect(detail.botSummary).toMatchObject({
          bot: "suzuka",
          verdict: { word: "Caution" },
          reviewedHead: detail.headRefOid,
        });
        expect(detail.timeline?.some((item) => item.id === "IC_suzuka")).toBe(false);
        expect(detail.timeline?.find((item) => item.id === "IC_human")?.kind).toBe("comment");
        expect(detail.timeline?.find((item) => item.id === "R_approved")).toMatchObject({
          kind: "review",
          state: "approved",
        });
        const thread = detail.timeline?.find((item) => item.id === "T_suzuka");
        expect(thread).toMatchObject({
          kind: "thread",
          comments: [{ author: { login: "suzuka", bot: true } }],
        });
        expect(detail.checkRuns).toMatchObject([
          {
            name: "typecheck",
            workflow: "CI",
            status: "completed",
            conclusion: "success",
            durationMs: 60_000,
          },
        ]);
        expect(detail.commitList?.[0]?.oid).toBe(detail.headRefOid);
        expect(detail.viewerLastReview?.commitOid).toBe(detail.headRefOid);
        const count = h.fake.requests.length;
        yield* gh.detail(pull);
        expect(h.fake.requests.length).toBe(count);
      })
    );
  });

  test("paginates each connection independently beyond 100 rows without duplicates", async () => {
    const h = open();
    const id = "PR_kwDOacme42";
    const at = "2026-10-01T12:00:00Z";
    h.fake.world.commits.set(
      id,
      Array.from({ length: 205 }, (_, i) => ({
        oid: i.toString(16).padStart(40, "0"),
        message: `Commit ${i}\nDetails`,
        date: at,
      }))
    );
    h.fake.world.issueComments.set(
      id,
      Array.from({ length: 105 }, (_, i) => ({
        id: `c-${i}`,
        body: `Comment ${i}`,
        author: "mona",
        createdAt: at,
        updatedAt: at,
      }))
    );

    await h.run(
      Effect.gen(function* () {
        yield* signIn(h, "mona");
        const gh = yield* GitHub;
        const detail = yield* gh.detail(pull);
        expect(detail.commitList).toHaveLength(205);
        expect(new Set(detail.commitList?.map((c) => c.oid)).size).toBe(205);
        expect(detail.timeline?.filter((item) => item.kind === "comment")).toHaveLength(105);
        expect(h.fake.requests.filter((r) => r.name === "PullOverview").length % 3).toBe(0);
      })
    );
  });

  test("commands and Comment now post issue comments as the viewer; blank guidance is refused", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        yield* signIn(h, "mona");
        const gh = yield* GitHub;

        for (const command of ["review", "retry", "memory"] as const)
          yield* gh.botCommand({ pull, bot: "suzuka", command, text: "Watch expiry" });
        const posted = yield* gh.comment({ pull, body: "Please add a test." });
        expect(posted.id).toBeString();
        expect(posted.url).toContain("comment");
        expect(
          h.fake.world.issueComments
            .get("PR_kwDOacme42")
            ?.slice(-4)
            .map((c) => [c.author, c.body])
        ).toEqual([
          ["mona", "/review"],
          ["mona", "/retry"],
          ["mona", "/memory Watch expiry"],
          ["mona", "Please add a test."],
        ]);
        expect(
          Exit.isFailure(
            yield* Effect.exit(gh.botCommand({ pull, bot: "suzuka", command: "memory", text: " " }))
          )
        ).toBe(true);
        expect(
          Exit.isFailure(
            yield* Effect.exit(gh.botCommand({ pull, bot: "other", command: "review" }))
          )
        ).toBe(true);
      })
    );
  });

  test("only the author publishes, with a head check, and edited descriptions stop matching", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        yield* signIn(h, "mona");
        const gh = yield* GitHub;
        const other = yield* gh.detail(pull);
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              gh.publishDescription({ pull, pullId: other.id, head: other.headRefOid, body: "No" })
            )
          )
        ).toBe(true);
        const own = yield* gh.detail(mine);
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              gh.publishDescription({
                pull: mine,
                pullId: own.id,
                head: "0".repeat(40),
                body: "No",
              })
            )
          )
        ).toBe(true);

        const result = yield* gh.publishDescription({
          pull: mine,
          pullId: own.id,
          head: own.headRefOid,
          body: "## Why the change\nA walkthrough.",
        });

        expect(result.hash).toHaveLength(64);
        const updated = yield* gh.detail(mine);
        expect(updated.published).toMatchObject({
          hash: result.hash,
          head: own.headRefOid,
          matches: true,
        });
        const fakePull = h.fake.world.pulls.find((p) => p.id === own.id);

        if (fakePull === undefined) throw new Error("Missing own fixture");
        fakePull.body = "Manual edit";
        yield* gh.refresh;
        yield* until(gh.details, (details) =>
          details.some((d) => d.id === own.id && d.body === "Manual edit")
        );
        expect((yield* gh.detail(mine)).published?.matches).toBe(false);
      })
    );
    await h.run(
      Effect.gen(function* () {
        const restarted = yield* (yield* GitHub).detail(mine);
        expect(restarted.published?.hash).toHaveLength(64);
        expect(restarted.published?.matches).toBe(false);
      })
    );
  });

  test("Enterprise detail uses its own paths and supports comments, commits and checks", async () => {
    const h = open();
    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        yield* gh.addHost({ host: "ghe.acme.test", clientId: "0a1b2c3d4e5f6a7b8c9d" });
        yield* signIn(h, "mona-ent", "ghe.acme.test");

        const detail = yield* gh.detail({
          repo: { host: "ghe.acme.test", owner: "platform", name: "api" },
          number: 12,
        });

        expect(detail.host).toBe("ghe.acme.test");
        expect(detail.commitList).toHaveLength(1);
        expect(detail.timeline).toBeArray();
        expect(h.ghe.requests.some((r) => r.name === "PullOverview")).toBe(true);
      })
    );
  });
});
