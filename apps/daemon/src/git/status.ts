/**
 * `git status --porcelain=v2 --branch -z`, parsed into the `git.status` shape.
 */
import { runGit } from "./git.ts";

export interface StatusEntry {
  readonly path: string;
  readonly origPath: string | null;
  /** Porcelain X (index) status: `.`, M, A, D, R, C, U; `?` untracked, `!` ignored. */
  readonly index: string;
  /** Porcelain Y (worktree) status, same alphabet. */
  readonly worktree: string;
}

export interface Status {
  readonly branch: string | null;
  readonly head: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly entries: ReadonlyArray<StatusEntry>;
}

interface BranchHeader {
  branch: string | null;
  head: string | null;
  ahead: number;
  behind: number;
}

/** Applies one `# branch.*` header line to `header`. */
const applyHeader = (header: BranchHeader, record: string): void => {
  const [, key, ...rest] = record.split(" ");
  const value = rest.join(" ");

  if (key === "branch.oid") header.head = value === "(initial)" ? null : value;
  else if (key === "branch.head") header.branch = value === "(detached)" ? null : value;
  else if (key === "branch.ab") {
    const match = /^\+(\d+) -(\d+)$/.exec(value);

    if (match) {
      header.ahead = Number(match[1]);
      header.behind = Number(match[2]);
    }
  }
};

/** An ordinary, unmerged or untracked/ignored entry (every kind but renames). */
const parseEntry = (record: string): StatusEntry | null => {
  const kind = record[0];

  if (kind === "1") {
    // 1 XY sub mH mI mW hH hI path
    const fields = splitN(record, 9);
    const xy = fields[1]!;

    return { path: fields[8]!, origPath: null, index: xy[0]!, worktree: xy[1]! };
  }

  if (kind === "u") {
    // u XY sub m1 m2 m3 mW h1 h2 h3 path
    const fields = splitN(record, 11);
    const xy = fields[1]!;

    return { path: fields[10]!, origPath: null, index: xy[0]!, worktree: xy[1]! };
  }

  if (kind === "?" || kind === "!") {
    return { path: record.slice(2), origPath: null, index: kind, worktree: kind };
  }

  return null;
};

/** Parses NUL-separated porcelain v2 output (with `--branch`). */
export const parsePorcelainV2 = (output: string): Status => {
  const header: BranchHeader = { branch: null, head: null, ahead: 0, behind: 0 };
  const entries: Array<StatusEntry> = [];
  const records = output.split("\0");

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;

    if (record === "") continue;

    if (record.startsWith("# ")) {
      applyHeader(header, record);
      continue;
    }

    if (record[0] === "2") {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const fields = splitN(record, 10);
      const xy = fields[1]!;
      const origPath = records[++i] ?? null;
      entries.push({ path: fields[9]!, origPath, index: xy[0]!, worktree: xy[1]! });
      continue;
    }

    const entry = parseEntry(record);

    if (entry !== null) entries.push(entry);
  }

  return { ...header, entries };
};

/** Splits on the first `n - 1` spaces; the last field keeps any spaces (paths). */
const splitN = (record: string, n: number): Array<string> => {
  const fields: Array<string> = [];
  let rest = record;

  for (let k = 0; k < n - 1; k++) {
    const at = rest.indexOf(" ");

    if (at < 0) break;
    fields.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }

  fields.push(rest);

  return fields;
};

export const gitStatus = async (cwd: string): Promise<Status> => {
  const result = await runGit(cwd, [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=normal",
  ]);

  return parsePorcelainV2(new TextDecoder().decode(result.stdout));
};
