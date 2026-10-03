import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { gitText } from "../../git/git.ts";
import { ServiceError } from "../../services.ts";

const FILES = [
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "uv.lock",
  "yarn.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "poetry.lock",
  ".tool-versions",
  "package.json",
  "pyproject.toml",
  "pnpm-workspace.yaml",
  "bunfig.toml",
  ".npmrc",
];

/** Git lists workspace manifests without traversing installed dependencies. */
const inputNames = (cwd: string) =>
  Effect.tryPromise(async () => {
    const requirements = (await readdir(cwd)).filter((name) => /^requirements.*\.txt$/.test(name));

    const nested = existsSync(join(cwd, ".git"))
      ? (
          await gitText(cwd, [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            ...FILES.map((name) => `**/${name}`),
            "requirements*.txt",
            "**/requirements*.txt",
          ])
        )
          .split("\0")
          .filter((name) => name !== "")
      : [];

    return [...new Set([...FILES, ...requirements, ...nested])].sort();
  }).pipe(
    Effect.mapError(
      () =>
        new ServiceError({
          service: "WorktreeSetup",
          message: "Could not list setup inputs in the worktree.",
        })
    )
  );

/** Persist exact setup inputs so worktree reuse cannot hide a changed lockfile or command. */
export const setupFingerprint = Effect.fnUntraced(function* (cwd: string, command: string) {
  const hash = createHash("sha256").update(JSON.stringify(command));

  for (const name of yield* inputNames(cwd)) {
    const content = yield* Effect.tryPromise(() =>
      readFile(join(cwd, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    ).pipe(
      Effect.mapError(
        () =>
          new ServiceError({
            service: "WorktreeSetup",
            message: `Could not read setup input ${name}.`,
          })
      )
    );

    hash.update(JSON.stringify([name, content === null]));

    if (content !== null) hash.update(new Uint8Array(content));
  }

  return hash.digest("hex");
});
