import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReviewCheckoutBlocker } from "@polaris/protocol";
import { Predicate } from "effect";
import { CheckoutBlocked } from "../../services.ts";
import { gitText, resolveCommit } from "../git.ts";
import { commitAll, removeDir, tempDir, write } from "../testing.ts";
import { describeFetchFailure, fetchPullRequest, type PullRequestFetch } from "./fetch.ts";
import { reviewRef } from "./refs.ts";
import { parseRemoteUrl, pickFetchSource } from "./remotes.ts";
import {
  BASE_REPO,
  contributor,
  FORK_URL,
  makeForge,
  publishPullRequest,
  pushMain,
  userClone,
} from "./testing.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const setup = async () => {
  const forge = await makeForge();
  cleanup.push(forge.root);
  const author = await contributor(forge, forge.mainCommits[1] ?? "main");
  write(author, "feature.txt", "feature\n");
  await commitAll(author, "feature");
  const head = await publishPullRequest(forge, author, 7);

  return { forge, author, head };
};

const pr = (repoPath: string, overrides: Partial<PullRequestFetch> = {}): PullRequestFetch => ({
  repoPath,
  key: "7",
  repo: BASE_REPO,
  number: 7,
  baseRef: "main",
  baseCommit: "",
  unshallow: false,
  ...overrides,
});

const blockerOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CheckoutBlocked) return error.blocker;
    throw error;
  }

  throw new Error("expected the fetch to be blocked");
};

const userState = async (repo: string) => ({
  originMain: await resolveCommit(repo, "refs/remotes/origin/main"),
  head: await gitText(repo, ["rev-parse", "HEAD"]),
  branches: await gitText(repo, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"]),
  fetchHead: existsSync(join(repo, ".git", "FETCH_HEAD")),
});

describe("parseRemoteUrl", () => {
  test("reads scp-style, ssh:// and https URLs", () => {
    expect(parseRemoteUrl("git@github.com:Acme/App.git")).toEqual({
      transport: "ssh",
      host: "github.com",
      owner: "Acme",
      name: "App",
    });
    expect(parseRemoteUrl("ssh://git@GHE.example.com:2222/acme/app")).toMatchObject({
      transport: "ssh",
      host: "ghe.example.com",
      owner: "acme",
    });
    expect(parseRemoteUrl("https://user@github.com/acme/app.git/")).toMatchObject({
      transport: "https",
      name: "app",
    });
    expect(parseRemoteUrl("/srv/git/app.git")).toBeNull();
  });
});

describe("fetchPullRequest", () => {
  test("fetches the head and base into review refs and moves none of the user's refs", async () => {
    const { forge, head } = await setup();
    const user = await userClone(forge);
    cleanup.push(user);
    // main moves on the code host after the user's last fetch: origin/main must stay behind.
    const newMain = await pushMain(forge, "later.txt", "later\n");
    const before = await userState(user);

    const fetched = await fetchPullRequest(pr(user));

    expect(fetched).toEqual({ head, mergeBase: forge.mainCommits[1] ?? "" });
    expect(await resolveCommit(user, reviewRef("7", "head"))).toBe(head);
    expect(await resolveCommit(user, reviewRef("7", "base"))).toBe(newMain);
    expect(await userState(user)).toEqual(before);
    expect(before.originMain).not.toBe(newMain);
  });

  test("a fork's pull request comes from the base repository, not the user's fork remote", async () => {
    const forge = await makeForge();
    cleanup.push(forge.root);
    const author = await contributor(forge, "main");
    write(author, "fork.txt", "from a fork\n");
    await commitAll(author, "fork change");
    const head = await publishPullRequest(forge, author, 7, { viaFork: true });
    // origin is the user's fork; upstream is the base repository.
    const user = await userClone(forge, { remoteUrl: FORK_URL });
    cleanup.push(user);
    await gitText(user, ["remote", "add", "upstream", "git@github.com:acme/app.git"]);
    await gitText(user, ["config", `url.${forge.base}.insteadOf`, "git@github.com:acme/app.git"]);

    expect(await pickFetchSource(user, BASE_REPO)).toEqual({
      source: "upstream",
      transport: "ssh",
    });
    expect((await fetchPullRequest(pr(user))).head).toBe(head);
  });

  test("without a matching remote it fetches the repository by URL, adding no remote", async () => {
    const { forge, head } = await setup();
    const user = await userClone(forge, { remoteUrl: FORK_URL });
    cleanup.push(user);
    const remotes = await gitText(user, ["config", "--get-regexp", "^remote\\."]);

    expect(await pickFetchSource(user, BASE_REPO)).toEqual({
      source: "https://github.com/acme/app.git",
      transport: "https",
    });
    expect((await fetchPullRequest(pr(user))).head).toBe(head);
    expect(await gitText(user, ["config", "--get-regexp", "^remote\\."])).toBe(remotes);
  });

  test("a force-pushed head replaces the fetched one", async () => {
    const { forge, author, head } = await setup();
    const user = await userClone(forge);
    cleanup.push(user);
    await fetchPullRequest(pr(user));

    await gitText(author, ["reset", "-q", "--hard", "HEAD~1"]);
    write(author, "feature.txt", "rewritten\n");
    const rewritten = await commitAll(author, "feature, rewritten");
    await publishPullRequest(forge, author, 7);

    const fetched = await fetchPullRequest(pr(user));

    expect(fetched.head).toBe(rewritten);
    expect(rewritten).not.toBe(head);
  });

  test("a missing pull request is a FetchFailed the user can read", async () => {
    const { forge } = await setup();
    const user = await userClone(forge);
    cleanup.push(user);

    const blocker = await blockerOf(fetchPullRequest(pr(user, { number: 99, key: "99" })));

    expect(blocker).toEqual(
      ReviewCheckoutBlocker.cases.FetchFailed.make({
        message: "pull request #99 was not found on acme/app",
      })
    );
  });

  test("ssh runs the user's own ssh command with BatchMode, and fails without prompting", async () => {
    const { forge } = await setup();
    const user = await userClone(forge, { remoteUrl: "git@github.com:acme/app.git" });
    cleanup.push(user);
    await gitText(user, ["config", "--unset-all", `url.${forge.base}.insteadOf`]);
    const bin = tempDir("polaris-ssh-");
    cleanup.push(bin);
    const log = join(bin, "args");
    const ssh = join(bin, "fake-ssh");
    write(
      bin,
      "fake-ssh",
      `#!/bin/sh\necho "$@" > ${log}\necho "git@github.com: Permission denied (publickey)." >&2\nexit 255\n`
    );
    chmodSync(ssh, 0o755);
    await gitText(user, ["config", "core.sshCommand", `${ssh} -o UserOwnOption=yes`]);

    const blocker = await blockerOf(fetchPullRequest(pr(user)));

    expect(readFileSync(log, "utf8")).toContain("-o UserOwnOption=yes -o BatchMode=yes");
    expect(Predicate.isTagged(blocker, "FetchFailed") ? blocker.message : "").toStartWith(
      "ssh could not authenticate on this Host"
    );
  });

  test("a shallow clone fetches the code host's base commit, else says it is shallow", async () => {
    const { forge, head } = await setup();
    await pushMain(forge, "later.txt", "later\n");
    const user = await userClone(forge, { depth: 1 });
    cleanup.push(user);

    expect(await blockerOf(fetchPullRequest(pr(user)))).toEqual(
      ReviewCheckoutBlocker.cases.ShallowClone.make({})
    );

    const mergeBase = forge.mainCommits[1] ?? "";
    const fetched = await fetchPullRequest(pr(user, { baseCommit: mergeBase }));

    expect(fetched).toEqual({ head, mergeBase });
    expect(await gitText(user, ["rev-parse", "--is-shallow-repository"])).toBe("true");
  });

  test("unshallow fetches full history, only when asked", async () => {
    const { forge, head } = await setup();
    const user = await userClone(forge, { depth: 1 });
    cleanup.push(user);

    const fetched = await fetchPullRequest(pr(user, { unshallow: true }));

    expect(fetched).toEqual({ head, mergeBase: forge.mainCommits[1] ?? "" });
    expect(await gitText(user, ["rev-parse", "--is-shallow-repository"])).toBe("false");
  });
});

describe("describeFetchFailure", () => {
  const options = { number: 7, repo: BASE_REPO, timeoutMs: 600_000 };

  test("names a missing SSH agent", () => {
    const saved = process.env.SSH_AUTH_SOCK;
    delete process.env.SSH_AUTH_SOCK;

    try {
      expect(
        describeFetchFailure(
          { code: 128, stdout: new Uint8Array(), stderr: "Permission denied (publickey)." },
          "ssh",
          options
        )
      ).toBe(
        "ssh could not authenticate on this Host (the Daemon has no SSH agent: SSH_AUTH_SOCK is not set): Permission denied (publickey)."
      );
    } finally {
      if (saved !== undefined) process.env.SSH_AUTH_SOCK = saved;
    }
  });

  test("a killed fetch timed out", () => {
    expect(
      describeFetchFailure({ code: 137, stdout: new Uint8Array(), stderr: "" }, "https", options)
    ).toBe("the fetch timed out after 600 s");
  });

  test("anything else carries git's stderr", () => {
    expect(
      describeFetchFailure(
        { code: 128, stdout: new Uint8Array(), stderr: "fatal: terminal prompts disabled\n" },
        "https",
        options
      )
    ).toBe("git fetch failed: fatal: terminal prompts disabled");
  });
});
