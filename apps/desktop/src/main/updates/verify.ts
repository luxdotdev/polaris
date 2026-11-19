/** A downloaded Update is checked before Squirrel sees it (docs/adr/0116). */
import { mkdir, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { childProcesses } from "@polaris/client/process/node";
import { sha1Of } from "./download.ts";
import type { OfferedUpdate } from "./release.ts";

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
}

/** Runs a tool to its end; aborting `stop` kills it. */
export type Run = (file: string, args: ReadonlyArray<string>, stop?: AbortSignal) => Promise<Ran>;

/** Unpacking and checking a full app takes seconds; a tool silent for two minutes is stuck. */
const TOOL_TIMEOUT_MS = 120_000;

/** An unpacked Update may take this much disk; Polaris is a few hundred megabytes. */
export const MAX_UNPACKED_BYTES = 2 * 1024 ** 3;

/** How often the unpacking folder is measured. */
const WATCH_MS = 100;

/** The real tools, as child processes. */
export const runTool: Run = (file, args, stop) =>
  new Promise((resolve) => {
    const child = childProcesses.spawn({ file, args, timeoutMs: TOOL_TIMEOUT_MS });
    let stdout = "";

    stop?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });

    if (stop?.aborted === true) child.kill("SIGKILL");

    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
    });
    child.stderr?.resume();
    child.once("error", () => resolve({ code: null, stdout }));
    child.once("close", (code) => resolve({ code, stdout }));
  });

/** The running app's designated requirement: the same test Squirrel.Mac applies to an Update. */
export const designatedRequirement = async (bundle: string, exec: Run = runTool) => {
  const shown = await exec("/usr/bin/codesign", ["--display", "--requirements", "-", bundle]);
  const requirement = /^(?:# )?designated => (.+)$/m.exec(shown.stdout)?.[1]?.trim();

  return shown.code === 0 && requirement !== undefined && requirement !== "" ? requirement : null;
};

/** Block rounding makes a folder larger than the sum of its files; a lying zip gets no more. */
const ROUNDING_BYTES = 64 * 1024 ** 2;

/** The uncompressed bytes the zip's own listing adds up to, or null when it can't be read. */
const listedBytes = async (exec: Run, zip: string) => {
  const listed = await exec("/usr/bin/zipinfo", ["-t", zip]);
  const bytes = /(\d+) bytes uncompressed/.exec(listed.stdout)?.[1];

  return listed.code === 0 && bytes !== undefined ? Number(bytes) : null;
};

/** The disk a folder takes, or null unless the scan ended cleanly: a skipped subtree is not a total. */
const diskOf = async (exec: Run, path: string, stop?: AbortSignal) => {
  const measured = await exec("/usr/bin/du", ["-sk", path], stop);
  const kilobytes = /^(\d+)\s/.exec(measured.stdout)?.[1];

  return measured.code === 0 && kilobytes !== undefined ? Number(kilobytes) * 1024 : null;
};

/** Resolves after `ms`, or as soon as `stop` aborts. */
const pause = (ms: number, stop: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    stop.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/** One scan at a time while `ditto` runs; false once the folder passes `ceiling` or can't be measured. */
const watched = async (exec: Run, scratch: string, ceiling: number, done: AbortSignal) => {
  for (;;) {
    await pause(WATCH_MS, done);

    if (done.aborted) return true;
    const bytes = await diskOf(exec, scratch, done);

    if (done.aborted) return true;

    if (bytes === null || bytes > ceiling) return false;
  }
};

/**
 * Unpacks `zip` with ditto inside a disk budget. A zip listing more than `limit` is refused
 * unopened; the listing can lie, so the folder is also measured as it grows and ditto killed.
 */
const unpack = async (exec: Run, zip: string, scratch: string, limit: number) => {
  const listed = await listedBytes(exec, zip);

  if (listed === null || listed > limit) return false;
  const ceiling = Math.min(limit, listed * 2 + ROUNDING_BYTES);
  const kill = new AbortController();
  const done = new AbortController();

  const within = watched(exec, scratch, ceiling, done.signal).then((fits) => {
    if (!fits) kill.abort();

    return fits;
  });

  try {
    const unpacked = await exec("/usr/bin/ditto", ["-x", "-k", zip, scratch], kill.signal);

    // Ends the watch and kills a scan still running.
    done.abort();

    if (unpacked.code !== 0 || !(await within)) return false;
    const bytes = await diskOf(exec, scratch);

    return bytes !== null && bytes <= ceiling;
  } finally {
    done.abort();
  }
};

export interface MacVerifyInput {
  readonly zip: string;
  /** A scratch folder beside the download; removed whatever the outcome. */
  readonly scratch: string;
  /** The running Polaris.app, whose signer the Update must share. */
  readonly bundle: string;
  readonly run?: Run;
  /** Replaces `MAX_UNPACKED_BYTES`; tests only. */
  readonly maxUnpackedBytes?: number;
}

/** The zip holds one app whose signature is intact and satisfies the running app's requirement. */
export const verifyMacUpdate = async (input: MacVerifyInput): Promise<boolean> => {
  const exec = input.run ?? runTool;

  try {
    const requirement = await designatedRequirement(input.bundle, exec);

    if (requirement === null) return false;
    await exec("/bin/rm", ["-rf", input.scratch]);
    await mkdir(input.scratch, { recursive: true });
    const limit = input.maxUnpackedBytes ?? MAX_UNPACKED_BYTES;

    if (!(await unpack(exec, input.zip, input.scratch, limit))) return false;
    const apps = (await readdir(input.scratch)).filter((entry) => entry.endsWith(".app"));

    if (apps.length !== 1) return false;

    const checked = await exec("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      `-R=${requirement}`,
      join(input.scratch, apps[0] ?? ""),
    ]);

    return checked.code === 0;
  } catch {
    return false;
  } finally {
    // A child process: the unpacked app is large, and Electron's own fs cannot empty its asar.
    await exec("/bin/rm", ["-rf", input.scratch]).catch(() => undefined);
  }
};

/** Windows: the size and SHA-1 the feed's RELEASES promised over https, read from the open file. */
export const verifyWindowsUpdate = async (
  _path: string,
  update: OfferedUpdate,
  bytes: number,
  file: FileHandle
) => {
  if (update.sha1 === null || update.bytes !== bytes) return false;

  try {
    return (await file.stat()).size === bytes && (await sha1Of(file)) === update.sha1;
  } catch {
    return false;
  }
};
