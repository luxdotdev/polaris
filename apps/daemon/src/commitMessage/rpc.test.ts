import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CommitSuggestMessage } from "@polaris/protocol";
import { Effect, Result, Stream } from "effect";
import { RpcGroup, RpcTest } from "effect/rpc";
import { CommitMessageRpcsLive } from "./index.ts";
import { availability, git, repo, request, stageFile } from "./testing.ts";

test("commit.suggestMessage streams a message without touching the index or HEAD", async () => {
  const root = repo(["feat: start"]);
  const previous = process.env.POLARIS_BENCH_HARNESS;
  process.env.POLARIS_BENCH_HARNESS = "1";
  stageFile(root, "a.ts", "a\n");
  const index = readFileSync(join(root, ".git", "index"));
  const head = readFileSync(join(root, ".git", "refs", "heads", "main"), "utf8");

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(RpcGroup.make(CommitSuggestMessage));
          const items = yield* rpc["commit.suggestMessage"](request(root)).pipe(Stream.runCollect);

          expect(items.at(-1)).toMatchObject({ message: { subject: "Update a.ts" } });
          expect(readFileSync(join(root, ".git", "index")).equals(index)).toBe(true);
          expect(readFileSync(join(root, ".git", "refs", "heads", "main"), "utf8")).toBe(head);

          git(root, "reset", "-q");

          const empty = yield* rpc["commit.suggestMessage"](request(root)).pipe(
            Stream.runCollect,
            Effect.result
          );

          expect(Result.isFailure(empty) && empty.failure.reason).toBe("nothing-staged");
        })
      ).pipe(Effect.provide(CommitMessageRpcsLive), Effect.provide(availability("ready")))
    );
  } finally {
    if (previous === undefined) delete process.env.POLARIS_BENCH_HARNESS;
    else process.env.POLARIS_BENCH_HARNESS = previous;

    rmSync(root, { recursive: true, force: true });
  }
});
