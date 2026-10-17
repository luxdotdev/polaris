/**
 * Windows' process tree, as `Win32_Process` reports it. A `ParentProcessId` is never
 * cleared: once the parent exits, its pid can go to an unrelated process, which then looks
 * like the parent. So a link counts only when the parent was created before the child.
 * See docs/adr/0061-windows-process-trees.md.
 */
import { childEnv } from "../service/childEnv.ts";
import { system32 } from "./processes.ts";

export interface ProcessRow {
  readonly pid: number;
  readonly parent: number;
  /** Creation time as a FILETIME (100 ns ticks): past 2^53, so a bigint. */
  readonly created: bigint;
}

/** A process as of when it was started: a pid alone can name a later one. */
export interface ProcessIdentity {
  readonly pid: number;
  readonly created: bigint;
}

/** Rows of `pid parent created`, as `processTable` prints them; malformed rows are skipped. */
export const parseProcessTable = (text: string): ReadonlyMap<number, ProcessRow> => {
  const rows = new Map<number, ProcessRow>();

  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d+) (\d+) (\d+)$/.exec(line.trim());

    if (match !== null) {
      const [, pid, parent, created] = match;

      rows.set(Number(pid), {
        pid: Number(pid),
        parent: Number(parent),
        created: BigInt(created!),
      });
    }
  }

  return rows;
};

/**
 * True if `pid` is `root` or below it. Each step up must reach a parent created no later
 * than the child, and the walk must end at `root` as it was started.
 */
export const isInTree = (
  table: ReadonlyMap<number, ProcessRow>,
  root: ProcessIdentity,
  pid: number
): boolean => {
  let at = table.get(pid);

  // Bounded: creation times only go back, so a loop can't pass the check, but stay safe.
  for (let hops = 0; at !== undefined && hops < 64; hops++) {
    if (at.pid === root.pid) return at.created === root.created;
    const parent = table.get(at.parent);

    if (parent === undefined || parent.created > at.created) return false;
    at = parent;
  }

  return false;
};

/** The whole process table now, or an empty one if it can't be read. */
export const processTable = (): ReadonlyMap<number, ProcessRow> => {
  const result = Bun.spawnSync(
    [
      system32("WindowsPowerShell\\v1.0\\powershell.exe"),
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToFileTimeUtc())" }',
    ],
    // A stalled WMI would otherwise block the event loop for good; past this it reads as empty.
    { env: childEnv(), stdin: "ignore", stderr: "ignore", windowsHide: true, timeout: 30_000 }
  );

  return parseProcessTable(result.exitCode === 0 ? result.stdout.toString() : "");
};

/** `pid` as it is now, or null if it is gone. */
export const identityOf = (pid: number): ProcessIdentity | null => {
  const row = processTable().get(pid);

  return row === undefined ? null : { pid, created: row.created };
};
