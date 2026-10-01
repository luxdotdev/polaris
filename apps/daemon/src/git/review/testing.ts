/**
 * Test helpers: a local "code host" (bare repositories with hand-made
 * `refs/pull/<n>/head`) and a user clone whose remotes look like GitHub URLs,
 * mapped to the local repositories with `url.<path>.insteadOf`. Not used at runtime.
 */
import { join } from "node:path";
import { RepoRef } from "@polaris/protocol";
import { gitText } from "../git.ts";
import { commitAll, tempDir, write } from "../testing.ts";

export const BASE_REPO = new RepoRef({ host: "github.com", owner: "acme", name: "app" });

export const BASE_URL = "https://github.com/acme/app.git";

export const FORK_URL = "https://github.com/someone/app.git";

export interface Forge {
  readonly root: string;
  /** The base repository on the code host. */
  readonly base: string;
  /** A contributor's fork of it. */
  readonly fork: string;
  /** The maintainers' working clone, which pushes `main`. */
  readonly upstream: string;
  /** Commits on `main`, oldest first. */
  readonly mainCommits: Array<string>;
}

const identity = async (repo: string) => {
  await gitText(repo, ["config", "user.name", "Test"]);
  await gitText(repo, ["config", "user.email", "test@example.com"]);
  await gitText(repo, ["config", "commit.gpgsign", "false"]);
};

/** A base repository with three commits on `main`, and an empty fork. */
export const makeForge = async (): Promise<Forge> => {
  const root = tempDir("polaris-forge-");
  const base = join(root, "base.git");
  const fork = join(root, "fork.git");
  await gitText(root, ["init", "-q", "--bare", "-b", "main", base]);
  await gitText(root, ["init", "-q", "--bare", "-b", "main", fork]);
  // GitHub serves any reachable commit by id; a shallow clone fetches its base commit that way.
  await gitText(base, ["config", "uploadpack.allowAnySHA1InWant", "true"]);

  const upstream = join(root, "upstream");
  await gitText(root, ["init", "-q", "-b", "main", upstream]);
  await identity(upstream);
  write(upstream, "app.txt", lines(10));
  await commitAll(upstream, "initial");
  await gitText(upstream, ["remote", "add", "origin", base]);
  const mainCommits = [await gitText(upstream, ["rev-parse", "HEAD"])];

  for (const n of [1, 2]) {
    write(upstream, `main-${n}.txt`, `main ${n}\n`);
    mainCommits.push(await commitAll(upstream, `main ${n}`));
  }

  await gitText(upstream, ["push", "-q", "origin", "main"]);
  await gitText(upstream, ["push", "-q", fork, "main"]);

  return { root, base, fork, upstream, mainCommits };
};

/** `n` numbered lines, for edits a merge can tell apart. */
export const lines = (n: number, edit: Record<number, string> = {}): string =>
  `${Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join("\n")}\n`;

/** Advance `main` on the code host by one commit. */
export const pushMain = async (forge: Forge, file: string, content: string): Promise<string> => {
  write(forge.upstream, file, content);
  const commit = await commitAll(forge.upstream, `main: ${file}`);
  await gitText(forge.upstream, ["push", "-q", "origin", "main"]);
  forge.mainCommits.push(commit);

  return commit;
};

/** A contributor's working copy, cloned from the base repository at `from`. */
export const contributor = async (forge: Forge, from: string): Promise<string> => {
  const dir = join(tempDir("polaris-author-"), "app");
  await gitText(forge.root, ["clone", "-q", forge.base, dir]);
  await identity(dir);
  await gitText(dir, ["checkout", "-q", "-B", "topic", from]);

  return dir;
};

/** What GitHub does when a PR's branch moves: point `refs/pull/<n>/head` at it (forced). */
export const publishPullRequest = async (
  forge: Forge,
  author: string,
  number: number,
  options: { readonly viaFork?: boolean } = {}
): Promise<string> => {
  const head = await gitText(author, ["rev-parse", "HEAD"]);

  if (options.viaFork) await gitText(author, ["push", "-q", "-f", forge.fork, "HEAD:topic"]);
  await gitText(author, ["push", "-q", "-f", forge.base, `HEAD:refs/pull/${number}/head`]);

  return head;
};

/**
 * The user's clone: `origin` is `remoteUrl` (the base repository by default)
 * as a GitHub URL; both GitHub URLs are mapped to the local repositories.
 */
export const userClone = async (
  forge: Forge,
  options: { readonly depth?: number; readonly remoteUrl?: string } = {}
): Promise<string> => {
  const dir = join(tempDir("polaris-user-"), "app");
  const depth = options.depth === undefined ? [] : ["--depth", String(options.depth)];
  await gitText(forge.root, ["clone", "-q", ...depth, `file://${forge.base}`, dir]);
  await identity(dir);
  await gitText(dir, ["config", `url.${forge.base}.insteadOf`, BASE_URL]);
  await gitText(dir, ["config", `url.${forge.fork}.insteadOf`, FORK_URL]);
  await gitText(dir, ["remote", "set-url", "origin", options.remoteUrl ?? BASE_URL]);

  return dir;
};
