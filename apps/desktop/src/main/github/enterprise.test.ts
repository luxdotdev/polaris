import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { FAKE_GHE_CLIENT_ID } from "../../../scripts/lib/githubFake/index.ts";
import type { PullRef } from "../../shared/github.ts";
import { endpointsFor } from "./config.ts";
import { GHE_HOST, harness, signIn, until } from "./github.testing.ts";
import { GitHub } from "./index.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

const open = () => {
  const h = harness();

  harnesses.push(h);

  return h;
};

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

const addGhe = GitHub.use((gh) =>
  gh.addHost({ host: `https://${GHE_HOST.toUpperCase()}/api/v3`, clientId: FAKE_GHE_CLIENT_ID })
);

const PR12: PullRef = { repo: { host: GHE_HOST, owner: "platform", name: "api" }, number: 12 };

/** GHE was served only under its own paths: nothing it got was a github.com path. */
const onlyEnterprisePaths = (h: ReturnType<typeof harness>) =>
  h.ghe.requests.filter((r) => r.kind !== "control" && r.status === 404).map((r) => r.name);

describe("endpoints per host", () => {
  const config = { web: "https://github.com", api: "https://api.github.com" };

  test("github.com, GitHub Enterprise Server, GHE.com, and a fake's base URL", () => {
    expect(endpointsFor(config, "github.com")).toEqual({
      web: "https://github.com",
      api: "https://api.github.com",
      graphql: "https://api.github.com/graphql",
    });
    expect(endpointsFor(config, "github.acme.com")).toEqual({
      web: "https://github.acme.com",
      api: "https://github.acme.com/api/v3",
      graphql: "https://github.acme.com/api/graphql",
    });
    expect(endpointsFor(config, "acme.ghe.com")).toEqual({
      web: "https://acme.ghe.com",
      api: "https://api.acme.ghe.com",
      graphql: "https://api.acme.ghe.com/graphql",
    });
    expect(
      endpointsFor(
        { ...config, hostUrls: { "github.acme.com": "http://127.0.0.1:4100/" } },
        "github.acme.com"
      )
    ).toEqual({
      web: "http://127.0.0.1:4100",
      api: "http://127.0.0.1:4100/api/v3",
      graphql: "http://127.0.0.1:4100/api/graphql",
    });
  });
});

describe("GitHub Enterprise hosts", () => {
  test("are added by host or URL with their OAuth App; github.com and bad input are refused", async () => {
    const h = open();

    const outcome = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const added = yield* addGhe;

        const refused = yield* Effect.forEach(
          [
            { host: "github.com", clientId: FAKE_GHE_CLIENT_ID },
            { host: "not a host", clientId: FAKE_GHE_CLIENT_ID },
            { host: GHE_HOST, clientId: "x" },
          ],
          (input) =>
            Effect.match(gh.addHost(input), { onFailure: (e) => e._tag, onSuccess: () => "ok" })
        );

        const view = yield* until(gh.accounts, (v) => v.hosts?.length === 2);

        return { added, refused, hosts: view.hosts ?? [] };
      })
    );

    expect(outcome.added).toBe(GHE_HOST);
    expect(outcome.refused).toEqual([
      "GitHubInvalidHost",
      "GitHubInvalidHost",
      "GitHubInvalidHost",
    ]);
    expect(outcome.hosts.map((x) => [x.host, x.removable, x.manageUrl])).toEqual([
      [
        "github.com",
        false,
        "https://github.test/settings/connections/applications/Ov23lix8h2ldBZFwXqek",
      ],
      [
        GHE_HOST,
        true,
        `https://${GHE_HOST}/settings/connections/applications/${FAKE_GHE_CLIENT_ID}`,
      ],
    ]);
  });

  test("signing in to an unknown host is refused before any request", async () => {
    const h = open();
    const exit = await h.run(Effect.exit(GitHub.use((gh) => gh.startSignIn(GHE_HOST))));

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("GitHubInvalidHost");
    expect(h.ghe.requests).toEqual([]);
  });

  test("the same user id on two hosts is two accounts; GHE's device flow uses its own app and paths", async () => {
    const h = open();

    const view = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* addGhe;
        yield* signIn(h, "mona");

        const started = yield* gh.startSignIn(GHE_HOST);

        expect(started.verificationUri).toBe(`https://${GHE_HOST}/login/device`);
        expect(started.host).toBe(GHE_HOST);
        h.ghe.approveDevice(started.userCode, "mona-ent");
        yield* h.advance(5000);

        return yield* until(gh.accounts, (v) => v.accounts.length === 2 && v.signIn === null);
      })
    );

    expect(view.accounts.map((a) => [a.id, a.host, a.userId, a.login])).toEqual([
      [1001, "github.com", 1001, "mona"],
      [-1, GHE_HOST, 1001, "mona-ent"],
    ]);
    expect(h.ghe.requests.map((r) => r.name)).toContain("GET /user");
    expect(onlyEnterprisePaths(h)).toEqual([]);
    expect(existsSync(join(h.dir, "tokens", "-1.bin"))).toBe(true);
  });

  test("lists, routes and reviews pull requests on GHE beside github.com", async () => {
    const h = open();

    const list = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* addGhe;
        yield* signIn(h, "mona");
        yield* signIn(h, "mona-ent", GHE_HOST);
        yield* gh.watch([
          {
            workspace: { hostKey: "local", workspaceId: "w1" },
            remotes: ["git@github.com:acme/widgets.git"],
          },
          {
            workspace: { hostKey: "pi", workspaceId: "w2" },
            remotes: [`git@${GHE_HOST}:platform/api.git`],
          },
          {
            workspace: { hostKey: "pi", workspaceId: "w3" },
            remotes: [`https://${GHE_HOST}/secure/keys`],
          },
        ]);

        const listed = yield* until(
          gh.pulls,
          (v) =>
            v.repos.length === 3 &&
            v.repos.every((r) => r.state !== "checking") &&
            v.requested.length >= 3
        );

        const detail = yield* gh.detail(PR12);

        yield* gh.addThread({
          pull: PR12,
          pullId: detail.id,
          commitOid: null,
          path: "src/audit/list.ts",
          body: "Cap the page size.",
          subjectType: "line",
          line: 12,
          side: "right",
          startLine: null,
          startSide: null,
        });
        yield* gh.submitReview({ pull: PR12, pullId: detail.id, event: "approve", body: "" });
        expect(detail.host).toBe(GHE_HOST);

        return listed;
      })
    );

    const row = list.requested.find((r) => r.repo === "platform/api");

    expect(row).toMatchObject({
      host: GHE_HOST,
      accountId: -1,
      workspaces: [{ hostKey: "pi", workspaceId: "w2" }],
    });
    expect(list.requested.filter((r) => r.host === "github.com").map((r) => r.number)).toEqual([
      42, 7,
    ]);
    expect(list.repos.find((r) => r.repo === "platform/api")).toMatchObject({
      host: GHE_HOST,
      state: "ok",
      login: "mona-ent",
    });
    expect(list.repos.find((r) => r.repo === "secure/keys")).toMatchObject({
      host: GHE_HOST,
      state: "blocked",
      approvalUrl: `https://${GHE_HOST}/settings/connections/applications/${FAKE_GHE_CLIENT_ID}`,
      ssoUrl: `https://${GHE_HOST}/orgs/secure/sso`,
    });
    expect(h.ghe.world.reviews.map((r) => [r.author, r.state])).toEqual([["mona-ent", "APPROVED"]]);
    expect(h.fake.world.reviews).toEqual([]);
    expect(onlyEnterprisePaths(h)).toEqual([]);
  });

  test("remotes on a host nobody added aren't watched", async () => {
    const h = open();

    const list = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        yield* gh.watch([
          {
            workspace: { hostKey: "local", workspaceId: "w1" },
            remotes: [`git@${GHE_HOST}:platform/api.git`],
          },
          {
            workspace: { hostKey: "local", workspaceId: "w2" },
            remotes: ["git@github.com:mona/dotfiles.git"],
          },
        ]);

        return yield* until(gh.pulls, (v) => v.repos.length === 1 && v.repos[0]?.state === "ok");
      })
    );

    expect(list.repos.map((r) => r.repo)).toEqual(["mona/dotfiles"]);
  });

  test("a GHE token refreshes through GHE's OAuth App", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* addGhe;
        yield* signIn(h, "mona-ent", GHE_HOST);
        h.ghe.expireAccessTokens();
        yield* gh.detail(PR12);
      })
    );

    expect(h.ghe.requests.filter((r) => r.name === "/login/oauth/access_token").length).toBe(2);
    expect(h.fake.requests).toEqual([]);
  });

  test("owner mappings are per host; removing a host signs its accounts out here", async () => {
    const h = open();

    const view = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* addGhe;
        yield* signIn(h, "mona-ent", GHE_HOST);
        yield* gh.setOwner("platform", -1, GHE_HOST);

        const mapped = yield* until(gh.accounts, (v) => Object.keys(v.owners).length === 1);

        expect(mapped.owners).toEqual({ [`${GHE_HOST}/platform`]: -1 });
        yield* gh.removeHost(GHE_HOST);

        return yield* until(gh.accounts, (v) => v.hosts?.length === 1);
      })
    );

    expect(view.accounts).toEqual([]);
    expect(view.owners).toEqual({});
    expect(existsSync(join(h.dir, "tokens", "-1.bin"))).toBe(false);
  });
});
