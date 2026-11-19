/** A downloaded Update is checked before Squirrel sees it (docs/adr/0116). */
import { mkdir, readdir } from "node:fs/promises";
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
const WATCH_MS = 250;

const run: Run = (file, args, stop) =>
  new Promise((resolve) => {
    const child = childProcesses.spawn({ file, args, timeoutMs: TOOL_TIMEOUT_MS });
    let stdout = "";

    stop?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });

    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
    });
    child.stderr?.resume();
    child.once("error", () => resolve({ code: null, stdout }));
    child.once("close", (code) => resolve({ code, stdout }));
  });

/** The running app's designated requirement: the same test Squirrel.Mac applies to an Update. */
export const designatedRequirement = async (bundle: string, exec: Run = run) => {
  const shown = await exec("/usr/bin/codesign", ["--display", "--requirements", "-", bundle]);
  const requirement = /^(?:# )?designated => (.+)$/m.exec(shown.stdout)?.[1]?.trim();

  return shown.code === 0 && requirement !== undefined && requirement !== "" ? requirement : null;
};

/** The disk a folder takes, or null when it can't be measured. */
const diskOf = async (exec: Run, path: string) => {
  const measured = await exec("/usr/bin/du", ["-sk", path]);
  const kilobytes = /^(\d+)\s/.exec(measured.stdout)?.[1];

  return measured.code === 0 && kilobytes !== undefined ? Number(kilobytes) * 1024 : null;
};

/**
 * Unpacks `zip` with ditto, which is killed once the folder passes `limit`: the sizes a zip
 * states are not the sizes it unpacks to, so the folder itself is measured as it grows.
 */
const unpack = async (exec: Run, zip: string, scratch: string, limit: number) => {
  const stop = new AbortController();

  const watch = setInterval(() => {
    void diskOf(exec, scratch).then((bytes) => {
      if (bytes !== null && bytes > limit) stop.abort();
    });
  }, WATCH_MS);

  try {
    const unpacked = await exec("/usr/bin/ditto", ["-x", "-k", zip, scratch], stop.signal);
    const bytes = await diskOf(exec, scratch);

    return unpacked.code === 0 && !stop.signal.aborted && bytes !== null && bytes <= limit;
  } finally {
    clearInterval(watch);
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
  const exec = input.run ?? run;

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

/** Windows: the size and SHA-1 the feed's RELEASES promised over https. */
export const verifyWindowsUpdate = async (path: string, update: OfferedUpdate, bytes: number) => {
  if (update.sha1 === null || update.bytes !== bytes) return false;

  try {
    return (await sha1Of(path)) === update.sha1;
  } catch {
    return false;
  }
};
