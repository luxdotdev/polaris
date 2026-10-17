/**
 * Whether a commit automatic git makes must be signed, and the `-c` options that sign it with
 * the Host's own settings (docs/adr/0068-accepts-merge-signs-with-the-hosts-own-settings.md).
 */
import { baseEnv, runGitRaw } from "./git.ts";
import { configListing, hostSigning, type Signing } from "./safeConfig/index.ts";

export type { Signing } from "./safeConfig/index.ts";

/** `commit.gpgSign` as git reads it, from every scope: a repository may ask for signing. */
const signingAsked = async (cwd: string) => {
  const result = await runGitRaw(cwd, ["config", "--type=bool", "--get", "commit.gpgsign"]);

  if (result.code === 1) return false;

  if (result.code !== 0) throw new Error(`git could not read commit.gpgSign: ${result.stderr}`);

  return new TextDecoder().decode(result.stdout).trim() === "true";
};

/** Null when no signing is asked for; otherwise how to sign, or why Polaris won't. */
export const commitSigning = async (cwd: string): Promise<Signing | null> => {
  if (!(await signingAsked(cwd))) return null;

  return hostSigning(await configListing(cwd, baseEnv()));
};

/** Global options that set `pairs` after the safe config's own, which they override. */
export const signingOptions = (signing: Signing | null): ReadonlyArray<string> =>
  signing?.kind === "sign"
    ? signing.pairs.flatMap(([key, value]) => ["-c", `${key}=${value}`])
    : [];
