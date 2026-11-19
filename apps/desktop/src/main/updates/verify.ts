/** A downloaded Update is checked before Squirrel sees it (docs/adr/0115). */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { childProcesses } from "@polaris/client/process/node";
import { sha1Of } from "./download.ts";
import type { OfferedUpdate } from "./release.ts";

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
}

export type Run = (file: string, args: ReadonlyArray<string>) => Promise<Ran>;

/** Unpacking and checking a full app takes seconds; a tool silent for two minutes is stuck. */
const TOOL_TIMEOUT_MS = 120_000;

const run: Run = (file, args) =>
  new Promise((resolve) => {
    const child = childProcesses.spawn({ file, args, timeoutMs: TOOL_TIMEOUT_MS });
    let stdout = "";

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

export interface MacVerifyInput {
  readonly zip: string;
  /** A scratch folder beside the download; removed whatever the outcome. */
  readonly scratch: string;
  /** The running Polaris.app, whose signer the Update must share. */
  readonly bundle: string;
  readonly run?: Run;
}

/** The zip holds one app whose signature is intact and satisfies the running app's requirement. */
export const verifyMacUpdate = async (input: MacVerifyInput): Promise<boolean> => {
  const exec = input.run ?? run;

  try {
    const requirement = await designatedRequirement(input.bundle, exec);

    if (requirement === null) return false;
    await exec("/bin/rm", ["-rf", input.scratch]);
    await mkdir(input.scratch, { recursive: true });
    const unpacked = await exec("/usr/bin/ditto", ["-x", "-k", input.zip, input.scratch]);
    const apps = (await readdir(input.scratch)).filter((entry) => entry.endsWith(".app"));

    if (unpacked.code !== 0 || apps.length !== 1) return false;

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
