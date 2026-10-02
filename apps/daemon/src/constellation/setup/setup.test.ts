import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CommandId,
  DomainEvent,
  SessionId,
  WorktreeSetup,
  WorkerPlacement,
  PreparedWorktree,
} from "@polaris/protocol";
import { Effect, Layer, Fiber } from "effect";
import { HarnessRegistry } from "../../services.ts";
import { makeFakeDriver } from "../../engine/testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { makeRepo, removeDir, tempDir } from "../../git/testing.ts";
import { session } from "../delivery/testing.ts";
import { CID, HOST, task, planned } from "../../engine/constellation.testing.ts";
import { prepareSession } from "../composition/prepare.ts";
import { setupCommand, WorktreeSetupService } from "./index.ts";

const SID = SessionId.make("setup-worker");

const fixture = (root: string) =>
  WorktreeSetupService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        EventStore.layerSqlite(join(root, "state.sqlite")),
        Layer.succeed(HarnessRegistry)({
          get: () => Effect.succeed(makeFakeDriver("codex").driver),
          all: Effect.succeed([]),
        })
      )
    )
  );

const seed = Effect.gen(function* () {
  const store = yield* EventStore;
  yield* store.commit({
    commandId: CommandId.make("seed"),
    decide: () =>
      Effect.succeed([DomainEvent.cases.SessionCreated.make({ session: session(SID) })]),
  });
});

test("detects all supported lockfiles in priority order; custom/disabled/no lock are explicit", async () => {
  const root = tempDir();

  try {
    expect(await Effect.runPromise(setupCommand(root, null))).toBe("");

    for (const [lock, command] of [
      ["uv.lock", "uv sync"],
      ["pnpm-lock.yaml", "pnpm install"],
      ["package-lock.json", "npm ci"],
      ["bun.lock", "bun install"],
    ]) {
      await writeFile(join(root, lock!), "");
      expect(await Effect.runPromise(setupCommand(root, null))).toBe(command!);
    }

    expect(await Effect.runPromise(setupCommand(root, WorktreeSetup.cases.Disabled.make({})))).toBe(
      ""
    );
    expect(
      await Effect.runPromise(
        setupCommand(root, WorktreeSetup.cases.Command.make({ command: "make setup" }))
      )
    ).toBe("make setup");
  } finally {
    removeDir(root);
  }
});

test("preparation completes setup before Attempt time; failure records attention without an Attempt or Turn", async () => {
  const root = await makeRepo();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const graph = planned([task()]).graph;

          const input = {
            key: "dispatch:A",
            graph,
            task: task(),
            previous: null,
            placement: WorkerPlacement.cases.New.make({ hostId: HOST }),
            worktree: PreparedWorktree.make({
              worktree: root,
              repoPath: root,
              branch: "main",
              base: "HEAD",
              managed: true,
              managedBranch: true,
            }),
            worktreeSetup: WorktreeSetup.cases.Command.make({
              command: "printf ready; mkdir node_modules",
            }),
          };

          const attempt = yield* prepareSession(input, HOST);
          const store = yield* EventStore;
          const worker = (yield* store.model).sessions.get(attempt.sessionId)!;
          expect(worker.session.worktreeSetup?.output).toBe("ready");
          expect(worker.session.worktreeSetup?.status).toBe("completed");
          expect(Date.parse(attempt.startedAt)).toBeGreaterThanOrEqual(
            Date.parse(worker.session.worktreeSetup!.endedAt!)
          );
          expect(worker.turns).toHaveLength(0);
          expect((yield* store.model).hostResources?.leases.size).toBe(0);

          const failed = yield* prepareSession(
            {
              ...input,
              key: "fail:A",
              worktreeSetup: WorktreeSetup.cases.Command.make({
                command: "printf broken >&2; exit 7",
              }),
            },
            HOST
          ).pipe(Effect.flip);

          expect(failed.findings[0]?.code).toBe("E-SETUP");

          const failedWorker = (yield* store.model).sessions.get(SessionId.make("fail:A:worker"))!;
          expect(failedWorker.session.state).toBe("failed");
          expect(failedWorker.session.worktreeSetup?.output).toBe("broken");
          expect(failedWorker.session.worktreeSetup?.exitCode).toBe(7);
          expect(failedWorker.turns).toHaveLength(0);
          expect((yield* store.model).constellations.size).toBe(0);
        })
      ).pipe(Effect.provide(fixture(root)))
    );
  } finally {
    removeDir(root);
  }
});

test("successful command retries are durable; failed setup can be repaired with the same dispatch ID", async () => {
  const root = tempDir();

  const command = "echo run >> setup-count; test -f ready";

  const program = Effect.scoped(
    Effect.gen(function* () {
      const store = yield* EventStore;
      const setup = yield* WorktreeSetupService;

      const invoke = () =>
        setup.run(
          SID,
          "retry:A",
          root,
          WorktreeSetup.cases.Command.make({ command }),
          CID,
          task().id
        );

      yield* seed;
      expect((yield* invoke())?.status).toBe("failed");
      yield* Effect.promise(() => writeFile(join(root, "ready"), ""));
      expect((yield* invoke())?.status).toBe("completed");
      yield* invoke();
      expect((yield* store.model).sessions.get(SID)!.session.turnCount).toBe(0);
    })
  );

  try {
    await Effect.runPromise(program.pipe(Effect.provide(fixture(root))));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* (yield* WorktreeSetupService).run(
            SID,
            "retry:A",
            root,
            WorktreeSetup.cases.Command.make({ command }),
            CID,
            task().id
          );
          expect(
            (yield* (yield* EventStore).model).sessions.get(SID)!.session.worktreeSetup?.status
          ).toBe("completed");
        })
      ).pipe(Effect.provide(fixture(root)))
    );
    expect(await readFile(join(root, "setup-count"), "utf8")).toBe("run\nrun\n");
  } finally {
    removeDir(root);
  }
});

test("canceling setup terminates its subprocess and records failed attention", async () => {
  const root = tempDir();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* seed;
          const setup = yield* WorktreeSetupService;
          const store = yield* EventStore;

          const process = yield* setup
            .run(
              SID,
              "cancel:A",
              root,
              WorktreeSetup.cases.Command.make({ command: "echo $$ > pid; exec sleep 60" }),
              CID,
              task().id
            )
            .pipe(Effect.forkChild);

          yield* Effect.promise(async () => {
            while (true) {
              try {
                await readFile(join(root, "pid"));

                return;
              } catch {
                await Bun.sleep(5);
              }
            }
          });
          yield* Fiber.interrupt(process);

          const card = (yield* store.model).sessions.get(SID)!.session.worktreeSetup;
          expect(card?.status).toBe("failed");
          expect((yield* store.model).sessions.get(SID)!.session.state).toBe("failed");

          const pid = Number(yield* Effect.promise(() => readFile(join(root, "pid"), "utf8")));
          expect(() => globalThis.process.kill(pid, 0)).toThrow();
        })
      ).pipe(Effect.provide(fixture(root)))
    );
  } finally {
    removeDir(root);
  }
}, 10_000);
