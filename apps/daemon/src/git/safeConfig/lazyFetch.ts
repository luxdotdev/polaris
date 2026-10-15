/**
 * A partial clone fetches a missing object from its promisor remote on any read, running
 * what that remote's config names (`uploadpack`, `ext::`). Automatic git never lazy-fetches.
 */
import { childEnv } from "../../service/childEnv.ts";
import type { Entry } from "./settings.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** git 2.44 and later read this: a missing object stays missing, nothing is fetched. */
export const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: "1" };

const MINIMUM_MINOR = 44;

const PROMISOR = /^remote\..+\.promisor$/;

const FALSE = new Set(["false", "no", "off", "0"]);

/** The repository is a partial clone, so a read of a missing object would fetch. */
export class GitLazyFetchUnsupported extends Error {
  constructor(readonly version: string | null) {
    super(
      `This repository is a partial clone, and this Host's git (${version ?? "unknown version"}) ` +
        "would fetch missing objects from its remote on its own. Polaris needs git 2.44 or later to read it"
    );
  }
}

export const isPartialClone = (entries: ReadonlyArray<Entry>): boolean =>
  entries.some(
    (e) =>
      e.key === "extensions.partialclone" ||
      (PROMISOR.test(e.key) && !FALSE.has(e.value.trim().toLowerCase()))
  );

/** Whether `git --version`'s output names a git that honours `GIT_NO_LAZY_FETCH`. */
export const honoursNoLazyFetch = (version: string | null): boolean => {
  const match = /^git version (\d+)\.(\d+)/.exec(version ?? "");

  if (match === null) return false;
  const major = Number(match[1]);

  return major > 2 || (major === 2 && Number(match[2]) >= MINIMUM_MINOR);
};

/** One `git --version` per `PATH`: the same PATH finds the same git. */
const versions = new Map<string, Promise<string | null>>();

const readVersion = async (base: Env): Promise<string | null> => {
  const binary = Bun.which("git", { PATH: base.PATH ?? "" }) ?? "git";

  const proc = Bun.spawn([binary, "--version"], {
    env: childEnv(base),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  return code === 0 ? out.trim() : null;
};

const gitVersion = (base: Env) => {
  const key = base.PATH ?? "";
  const known = versions.get(key);

  if (known !== undefined) return known;
  const read = readVersion(base).catch(() => null);
  versions.set(key, read);

  return read;
};

/** Fails closed: a partial clone under a git that ignores `GIT_NO_LAZY_FETCH` is never read. */
export const refuseLazyFetch = async (entries: ReadonlyArray<Entry>, base: Env) => {
  if (!isPartialClone(entries)) return;
  const version = await gitVersion(base);

  if (!honoursNoLazyFetch(version)) throw new GitLazyFetchUnsupported(version);
};
