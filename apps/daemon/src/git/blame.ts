/**
 * `git.blame` (ADR 0111): `git blame --porcelain` over a line range of a file as it is on disk,
 * so uncommitted lines come back with no commit. An untracked file is all uncommitted.
 * Read-only under the safe config; the repository's own ignore-revs list is not applied.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit, runGitRaw } from "./git.ts";
import { unquotePath } from "./quotePath.ts";

const BLAME_TIMEOUT_MS = 30_000;

/** Past this a file is generated or binary; blame refuses it. */
export const MAX_BLAME_BYTES = 16 * 1024 * 1024;

/** The all-zero id git gives lines that are not committed yet. */
const UNCOMMITTED = /^0+$/;

export interface BlamedCommit {
  readonly sha: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Committer time, epoch ms. */
  readonly time: number;
}

export interface BlamedLine {
  readonly line: number;
  /** The file's path in the commit that last changed the line; the current path when uncommitted. */
  readonly path: string;
  readonly text: string;
  readonly commit: BlamedCommit | null;
}

interface Header {
  author?: string;
  "author-mail"?: string;
  "committer-time"?: string;
  summary?: string;
  filename?: string;
}

const HEADER = /^([0-9a-f]{40,64}) \d+ (\d+)/;

const toCommit = (sha: string, header: Header): BlamedCommit | null =>
  UNCOMMITTED.test(sha)
    ? null
    : {
        sha,
        subject: header.summary ?? "",
        authorName: header.author ?? "",
        authorEmail: (header["author-mail"] ?? "").replace(/^<|>$/g, ""),
        time: Number(header["committer-time"] ?? 0) * 1000,
      };

/**
 * Lines of `git blame --porcelain`; each commit's fields come only with its first line, and its
 * `filename` with each group, so the last one seen names the file the line had there.
 */
export const parsePorcelainBlame = (output: string, path: string): ReadonlyArray<BlamedLine> => {
  const headers = new Map<string, Header>();
  const lines: Array<BlamedLine> = [];
  let current: { sha: string; line: number } | null = null;

  for (const row of output.split("\n")) {
    const start = HEADER.exec(row);

    if (start !== null) {
      current = { sha: start[1]!, line: Number(start[2]) };

      if (!headers.has(current.sha)) headers.set(current.sha, {});
    } else if (current !== null && row.startsWith("\t")) {
      lines.push({
        line: current.line,
        path: unquotePath(headers.get(current.sha)!.filename ?? path),
        text: row.slice(1),
        commit: toCommit(current.sha, headers.get(current.sha)!),
      });
      current = null;
    } else if (current !== null) {
      const space = row.indexOf(" ");
      const key = space === -1 ? row : row.slice(0, space);
      // SAFETY: only the Header keys are read back; other porcelain keys are kept and ignored.
      (headers.get(current.sha)! as Record<string, string>)[key] = row.slice(space + 1);
    }
  }

  return lines;
};

/** `path` relative to `root`, or null when it points outside it. */
export const pathInside = (root: string, path: string): string | null => {
  const inside = relative(root, resolve(root, path));

  if (inside === "" || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
    return null;

  return inside.split(sep).join("/");
};

const splitLines = (text: string): ReadonlyArray<string> => {
  const lines = text.split("\n");

  if (lines.at(-1) === "") lines.pop();

  return lines;
};

/** Lines `start`..`end` of the file at `checkout`/`path`, clamped to its length, all uncommitted. */
const uncommitted = (
  text: string,
  path: string,
  start: number,
  end: number
): ReadonlyArray<BlamedLine> =>
  splitLines(text)
    .slice(start - 1, end)
    .map((line, at) => ({
      line: start + at,
      path,
      text: line.replace(/\r$/, ""),
      commit: null,
    }));

/**
 * The real path of `path` in `checkout`: a regular file, under `MAX_BLAME_BYTES`, reached without
 * following a symlink, so a link can't read a file outside the checkout.
 */
const regularFileIn = async (checkout: string, path: string): Promise<string> => {
  const real = await realpath(join(checkout, path));

  if (
    relative(await realpath(checkout), real)
      .split(sep)
      .join("/") !== path
  )
    throw new Error(`${path} is a symlink or leaves the checkout`);
  const info = await stat(real);

  if (!info.isFile()) throw new Error(`${path} is not a file`);

  if (info.size > MAX_BLAME_BYTES) throw new Error(`${path} is too large to blame`);

  return real;
};

const isTracked = async (checkout: string, path: string): Promise<boolean> => {
  const listed = await runGitRaw(checkout, ["ls-files", "--error-unmatch", "--", path], {
    env: { GIT_LITERAL_PATHSPECS: "1" },
  });

  return listed.code === 0;
};

/**
 * Blames lines `start` through `end` of `path` (relative to `checkout`, as `pathInside` gives it),
 * clamped to the file.
 * Throws `GitCommandError` when git refuses (an unborn branch), and the file's read error when it is missing.
 */
export const blameLines = async (
  checkout: string,
  path: string,
  start: number,
  end: number
): Promise<ReadonlyArray<BlamedLine>> => {
  const text = await readFile(await regularFileIn(checkout, path), "utf8");
  const last = Math.min(end, splitLines(text).length);

  if (start > last) return [];

  if (!(await isTracked(checkout, path))) return uncommitted(text, path, start, last);

  const { stdout } = await runGit(
    checkout,
    ["blame", "--porcelain", "--ignore-revs-file=", "-L", `${start},${last}`, "--", path],
    { timeoutMs: BLAME_TIMEOUT_MS, env: { GIT_LITERAL_PATHSPECS: "1" } }
  );

  return parsePorcelainBlame(new TextDecoder().decode(stdout), path).map((line) => ({
    ...line,
    text: line.text.replace(/\r$/, ""),
  }));
};
