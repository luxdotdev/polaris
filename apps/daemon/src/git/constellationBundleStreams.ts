import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { BlobChannel, ServiceError } from "../services.ts";
import { gitText, resolveCommit } from "./git.ts";
import { gitOperation, transferError } from "../constellation/worktrees.ts";

const temporary = () => gitOperation(() => mkdtemp(join(tmpdir(), "polaris-bundle-")));

const cleanup = (path: string) => Effect.promise(() => rm(path, { recursive: true, force: true }));

/** The Wire owns the offered stream, including cleanup on disconnect; no bundle-sized allocation. */
export const offerBundle = Effect.fnUntraced(function* (repoPath: string, head: string) {
  const directory = yield* temporary();
  const path = join(directory, "history.bundle");
  const ref = `refs/polaris/transfers/${crypto.randomUUID()}`;

  const created = yield* gitOperation(async () => {
    const resolved = await resolveCommit(repoPath, head);

    if (resolved === null) throw new Error("The requested commit is unavailable");
    await gitText(repoPath, ["update-ref", ref, resolved]);

    try {
      await gitText(repoPath, ["bundle", "create", path, ref]);
    } finally {
      await gitText(repoPath, ["update-ref", "-d", ref]);
    }

    return resolved;
  }).pipe(Effect.onError(() => cleanup(directory)));

  const blobs = yield* BlobChannel;

  const source = Stream.fromReadableStream({
    evaluate: () => Bun.file(path).stream(),
    onError: (cause) =>
      new ServiceError({ service: "git", message: "Could not stream the git bundle", cause }),
  }).pipe(Stream.ensuring(cleanup(directory)));

  const blobId = yield* blobs.offer(source);

  return { head: created, ref, blobId };
});

/** Write incoming chunks straight to a temporary file, validate, then fetch only a Polaris ref. */
export const takeBundle = Effect.fnUntraced(function* (options: {
  repoPath: string;
  head: string;
  ref: string;
  targetRef: string;
  blobId: import("@polaris/protocol").BlobId;
}) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(temporary(), cleanup);
      const path = join(directory, "history.bundle");
      yield* gitOperation(() => writeFile(path, new Uint8Array()));
      const sink = Bun.file(path).writer();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await sink.end();
        })
      );
      const blobs = yield* BlobChannel;
      yield* blobs.takeStream(options.blobId).pipe(
        Stream.runForEach((bytes) =>
          gitOperation(async () => {
            await sink.write(bytes);
            await sink.flush();
          })
        ),
        Effect.catchTag("ServiceError", (error) =>
          Effect.fail(transferError("E-BLOB", error.message, true))
        )
      );
      yield* gitOperation(async () => {
        await sink.flush();
        await gitText(options.repoPath, ["bundle", "verify", path]);

        if (
          (await gitText(options.repoPath, ["bundle", "list-heads", path, options.ref])) !==
          `${options.head} ${options.ref}`
        )
          throw new Error("The bundle does not advertise the expected commit");
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
          throw new Error("The imported head does not match");
      });

      return { head: options.head };
    })
  );
});
