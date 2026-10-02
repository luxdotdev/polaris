import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gitText, runGit, runGitRaw, resolveCommit } from "./git.ts";

export const constellationRef = (constellationId: string, attemptId: string | null) =>
  `refs/polaris/constellations/${createHash("sha256").update(constellationId).digest("hex")}/${attemptId === null ? "base" : createHash("sha256").update(attemptId).digest("hex")}`;

const immutableHead = async (repoPath: string, head: string) => {
  const resolved = await resolveCommit(repoPath, head);

  if (resolved === null) throw new Error("The commit is unavailable in this repository");

  return resolved;
};

/** Self-contained history lets a remote Workspace receive the base without credentials or origin. */
export const exportBundle = async (repoPath: string, head: string) => {
  const resolved = await immutableHead(repoPath, head);
  const temporary = await mkdtemp(join(tmpdir(), "polaris-bundle-"));
  const ref = `refs/polaris/transfers/${crypto.randomUUID()}`;

  try {
    await gitText(repoPath, ["update-ref", ref, resolved]);
    const path = join(temporary, "history.bundle");
    await gitText(repoPath, ["bundle", "create", path, ref]);

    return { head: resolved, ref, bytes: new Uint8Array(await readFile(path)) };
  } finally {
    await gitText(repoPath, ["update-ref", "-d", ref]);
    await rm(temporary, { recursive: true, force: true });
  }
};

/** Import only into a Polaris ref; the user's branches and checkout never move. */
export const importBundle = async (options: {
  repoPath: string;
  head: string;
  ref: string;
  targetRef: string;
  bytes: Uint8Array;
}) => {
  const temporary = await mkdtemp(join(tmpdir(), "polaris-bundle-"));

  try {
    const path = join(temporary, "history.bundle");
    await writeFile(path, options.bytes);
    await gitText(options.repoPath, ["bundle", "verify", path]);
    const advertised = await gitText(options.repoPath, ["bundle", "list-heads", path, options.ref]);

    if (advertised !== `${options.head} ${options.ref}`)
      throw new Error("The bundle does not advertise the expected commit and ref");
    await gitText(options.repoPath, [
      "-c",
      "core.hooksPath=/dev/null",
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-auto-maintenance",
      "--refmap=",
      path,
      `+${options.ref}:${options.targetRef}`,
    ]);

    if ((await resolveCommit(options.repoPath, options.targetRef)) !== options.head)
      throw new Error("The imported head does not match the expected commit");

    return { head: options.head };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

export const pushOrigin = async (
  repoPath: string,
  branch: string,
  head: string,
  prefix: string
) => {
  if (!branch.startsWith(`${prefix.replace(/\/$/, "")}/`))
    throw new Error("Origin transfer is restricted to this Constellation's branch prefix");

  if ((await resolveCommit(repoPath, `refs/heads/${branch}`)) !== head)
    throw new Error("The Claim branch moved before transfer");
  await runGit(repoPath, ["push", "origin", `${head}:refs/heads/${branch}`], {
    timeoutMs: 600_000,
  });
};

export const fetchOrigin = async (
  repoPath: string,
  branch: string,
  head: string,
  targetRef: string
) => {
  const temporaryRef = `refs/polaris/transfers/${crypto.randomUUID()}`;

  try {
    await runGit(
      repoPath,
      [
        "-c",
        "core.hooksPath=/dev/null",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-auto-maintenance",
        "--refmap=",
        "origin",
        `+refs/heads/${branch}:${temporaryRef}`,
      ],
      { timeoutMs: 600_000 }
    );

    if ((await resolveCommit(repoPath, temporaryRef)) !== head)
      throw new Error("Origin's branch does not match the Claim head");
    await gitText(repoPath, ["-c", "core.hooksPath=/dev/null", "update-ref", targetRef, head]);

    return { head };
  } finally {
    await gitText(repoPath, ["-c", "core.hooksPath=/dev/null", "update-ref", "-d", temporaryRef]);
  }
};

export const mergedInto = async (repoPath: string, head: string, target: string) =>
  (await runGitRaw(repoPath, ["merge-base", "--is-ancestor", head, target])).code === 0;
