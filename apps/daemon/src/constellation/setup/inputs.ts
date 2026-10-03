import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { gitText } from "../../git/git.ts";
import { ServiceError } from "../../services.ts";

const FILES = [
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "uv.lock",
  "package.json",
  "pyproject.toml",
  "pnpm-workspace.yaml",
  "bunfig.toml",
  ".npmrc",
];

/** Git lists workspace manifests without traversing installed dependencies. */
const inputNames = (cwd: string) =>
  Effect.tryPromise(async () => {
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
          ])
        )
          .split("\0")
          .filter((name) => name !== "")
      : [];

    return [...new Set([...FILES, ...nested])].sort();
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
    const file = Bun.file(join(cwd, name));

    const content = yield* Effect.tryPromise(async () =>
      (await file.exists()) ? await file.arrayBuffer() : null
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
