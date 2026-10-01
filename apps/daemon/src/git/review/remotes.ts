/**
 * Which remote to fetch a pull request from: the user's remote whose URL is
 * the PR's base repository (so their transport, host alias and credentials
 * apply), else the repository's URL in the transport their other remotes on
 * that host use. And the ssh command that can never prompt.
 */
import type { RepoRef } from "@polaris/protocol";
import { runGitRaw } from "../git.ts";

export type Transport = "ssh" | "https" | "other";

export interface RemoteUrl {
  readonly transport: Transport;
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i;

const SCP_URL = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/;

const transportOf = (scheme: string): Transport => {
  const lower = scheme.toLowerCase();

  if (lower === "ssh" || lower === "git+ssh" || lower === "ssh+git") return "ssh";

  return lower === "https" || lower === "http" ? "https" : "other";
};

const ownerAndName = (path: string): { owner: string; name: string } | null => {
  const parts = path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter((part) => part !== "");

  const name = parts.at(-1);
  const owner = parts.at(-2);

  return owner === undefined || name === undefined ? null : { owner, name };
};

/** `git@H:o/n.git`, `ssh://git@H/o/n`, `https://H/o/n(.git)`; null for anything else (a local path). */
export const parseRemoteUrl = (url: string): RemoteUrl | null => {
  const trimmed = url.trim();
  const scheme = SCHEME_URL.exec(trimmed);

  if (scheme !== null) {
    const path = ownerAndName(scheme[3] ?? "");

    return path === null
      ? null
      : { transport: transportOf(scheme[1] ?? ""), host: (scheme[2] ?? "").toLowerCase(), ...path };
  }

  const scp = SCP_URL.exec(trimmed);

  if (scp === null) return null;
  const path = ownerAndName(scp[2] ?? "");

  return path === null ? null : { transport: "ssh", host: (scp[1] ?? "").toLowerCase(), ...path };
};

const sameRepo = (url: RemoteUrl, repo: RepoRef, host: string): boolean =>
  host === repo.host.toLowerCase() &&
  url.owner.toLowerCase() === repo.owner.toLowerCase() &&
  url.name.toLowerCase() === repo.name.toLowerCase();

const decoder = new TextDecoder();

/** The real hostname of an ssh host alias (`ssh -G`), or the alias itself. */
export const resolveSshHost = async (alias: string): Promise<string> => {
  try {
    const proc = Bun.spawn(["ssh", "-G", alias], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: 5000,
    });

    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (code !== 0) return alias;
    const line = out.split("\n").find((l) => l.startsWith("hostname "));

    return line === undefined ? alias : line.slice("hostname ".length).trim().toLowerCase();
  } catch {
    return alias;
  }
};

/** Remote names and their configured URLs (before `insteadOf`, which hides the host). */
export const listRemotes = async (
  repoPath: string
): Promise<ReadonlyArray<{ readonly name: string; readonly url: string }>> => {
  const result = await runGitRaw(repoPath, ["config", "--get-regexp", "^remote\\..*\\.url$"]);

  if (result.code !== 0) return [];

  return decoder
    .decode(result.stdout)
    .split("\n")
    .flatMap((line) => {
      const match = /^remote\.(.+)\.url (.+)$/.exec(line);

      return match === null ? [] : [{ name: match[1] ?? "", url: match[2] ?? "" }];
    });
};

export interface FetchSource {
  /** A remote's name, or a URL when no remote is the base repository. */
  readonly source: string;
  readonly transport: Transport;
}

/** The remote that is `repo` (matching ssh host aliases too), else `repo`'s URL. */
export const pickFetchSource = async (repoPath: string, repo: RepoRef): Promise<FetchSource> => {
  const parsed = (await listRemotes(repoPath)).flatMap((remote) => {
    const url = parseRemoteUrl(remote.url);

    return url === null ? [] : [{ name: remote.name, url }];
  });

  for (const { name, url } of parsed) {
    const host =
      url.transport === "ssh" && url.host !== repo.host.toLowerCase()
        ? await resolveSshHost(url.host)
        : url.host;

    if (sameRepo(url, repo, host)) return { source: name, transport: url.transport };
  }

  const sshOnHost = parsed.some(
    ({ url }) => url.transport === "ssh" && url.host === repo.host.toLowerCase()
  );

  return sshOnHost
    ? { source: `git@${repo.host}:${repo.owner}/${repo.name}.git`, transport: "ssh" }
    : { source: `https://${repo.host}/${repo.owner}/${repo.name}.git`, transport: "https" };
};

/**
 * The ssh command git would use (`GIT_SSH_COMMAND`, else `core.sshCommand`,
 * else `ssh`) with BatchMode appended; setting `GIT_SSH_COMMAND` replaces the config.
 */
export const batchSshCommand = async (repoPath: string): Promise<string> => {
  const fromEnv = process.env.GIT_SSH_COMMAND?.trim() ?? "";
  const configured = await runGitRaw(repoPath, ["config", "--get", "core.sshCommand"]);
  const own = configured.code === 0 ? decoder.decode(configured.stdout).trim() : "";
  const base = fromEnv !== "" ? fromEnv : own === "" ? "ssh" : own;

  return `${base} -o BatchMode=yes -o ConnectTimeout=15`;
};
