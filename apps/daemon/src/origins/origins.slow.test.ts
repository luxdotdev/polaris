/**
 * Origins end to end (ADR 0111): a fake Harness writes files during its Turns, the real
 * Checkpoints snapshot the repository, and `Origins` blames and matches them through real git.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  Command,
  type OriginLineQuery,
  SessionId,
  SessionPlacement,
  type TurnId,
  type Workspace,
} from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { CheckpointsLive } from "../git/Checkpoints.ts";
import { gitText } from "../git/git.ts";
import { dropSessionCheckpoints, listCheckpointRefs } from "../git/prune.ts";
import { makeRepo } from "../git/testing.ts";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../engine/testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { turnKey } from "../store/origins.ts";
import { type Blamed, Origins, OriginsConfig } from "./index.ts";

const TOTAL = [
  "export function computeTotal(items: Array<number>) {",
  "  const total = items.reduce((sum, item) => sum + item, 0);",
  "  return total;",
  "}",
  "",
].join("\n");

const LABEL = ["export const describeTotal = (total: number) => `Total: ${total}`;", ""].join("\n");

/** What each prompt makes the fake Harness write, relative to the repository. */
const WRITES = new Map([
  ["total", { "src/total.ts": TOTAL }],
  ["label", { "src/label.ts": LABEL }],
]);

type Env = Engine | EventStore | Origins;

const setup = (repo: string, filename = join(tempDir(), "state.sqlite"), withOrigins = true) => {
  const claude = makeFakeDriver("claude", {
    onTurn: (input) => {
      for (const [path, content] of Object.entries(WRITES.get(input.prompt) ?? {})) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), content);
      }

      return completesTurns()(input);
    },
  });

  const engine = engineLayer({
    filename,
    fakes: makeFakes(),
    drivers: [claude],
    checkpoints: CheckpointsLive,
  });

  if (!withOrigins) return engine;

  return Layer.provideMerge(Origins.layer, engine).pipe(
    Layer.provide(Layer.succeed(OriginsConfig)({ backfillDelay: 0, backfillPause: 0 }))
  );
};

const run = <A, E>(
  layer: Layer.Layer<Env> | Layer.Layer<Engine | EventStore>,
  program: Effect.Effect<A, E, Env>
) =>
  // SAFETY: a layer without Origins only runs programs that never ask for it (the backfill's first half).
  Effect.runPromise(program.pipe(Effect.provide(layer as Layer.Layer<Env>)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const git = (repo: string, ...args: ReadonlyArray<string>) =>
  Effect.promise(() => gitText(repo, args, { config: "host" }));

const registerWorkspace = (repo: string) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

    return [...model.workspaces.values()].find((w) => w.path === repo)!;
  });

/** Runs `prompt` as a new session's first Turn and waits until it is fingerprinted. */
const agentTurn = (workspace: Workspace, sessionId: SessionId, prompt: string, indexed = true) =>
  Effect.gen(function* () {
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt,
        attachments: [],
      })
    );

    const model = yield* waitFor(
      (m) => m.sessions.get(sessionId)?.session.state === "idle",
      5000,
      "the Turn ends"
    );

    const turnId = model.sessions.get(sessionId)!.turns[0]!.id;

    if (indexed) yield* waitIndexed(sessionId, turnId);

    return turnId;
  });

const waitIndexed = (sessionId: SessionId, turnId: TurnId) =>
  Effect.gen(function* () {
    const store = yield* EventStore;

    for (let i = 0; i < 1000; i++) {
      const done = yield* store.origins.indexedTurns([sessionId]);

      if (done.has(turnKey(sessionId, turnId))) return;
      yield* Effect.sleep("10 millis");
    }

    return yield* Effect.die(new Error(`${turnId} was never fingerprinted`));
  });

const query = (blamed: Blamed): ReadonlyArray<OriginLineQuery> =>
  blamed.lines.map((l) => ({
    line: l.line,
    hash: l.hash,
    commitSha: l.commit?.sha ?? null,
    commitTime: l.commit?.time ?? null,
  }));

/** Each line's Origins as `session:turn` strings, after blaming `path` through `origins.match`. */
const originsOf = (workspace: Workspace, path: string, startLine = 1, endLine = 100) =>
  Effect.gen(function* () {
    const origins = yield* Origins;
    const blamed = yield* origins.blame({ workspaceId: workspace.id, path, startLine, endLine });
    const matched = yield* origins.match(blamed.repoKey, query(blamed));

    return {
      blamed,
      matched,
      lines: matched.lines.map((l) =>
        l.origins.flatMap((o) => o.turnIds.map((turnId) => `${o.sessionId}:${turnId}`))
      ),
    };
  });

const commitAll = (repo: string, message: string) =>
  Effect.gen(function* () {
    yield* git(repo, "add", "-A");
    yield* git(repo, "commit", "-q", "-m", message);

    return yield* git(repo, "rev-parse", "HEAD");
  });

const sid = SessionId.make("s-origins");

describe("Origins", () => {
  test("a human commit of an agent's lines traces back to its session and Turn", async () => {
    const repo = await makeRepo();

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        const turnId = yield* agentTurn(workspace, sid, "total");
        const origin = `${sid}:${turnId}`;

        const uncommitted = yield* originsOf(workspace, "src/total.ts");

        expect(uncommitted.blamed.lines.map((l) => l.commit)).toEqual([null, null, null, null]);
        // `return total;` and `}` are too short to identify: they take the hunk's Origin.
        expect(uncommitted.blamed.lines.map((l) => l.hash === null)).toEqual([
          false,
          false,
          true,
          true,
        ]);
        expect(uncommitted.lines).toEqual([[origin], [origin], [origin], [origin]]);

        const sha = yield* commitAll(repo, "Add computeTotal");
        const committed = yield* originsOf(workspace, "src/total.ts");

        expect(committed.blamed.lines.every((l) => l.commit?.sha === sha)).toBe(true);
        expect(committed.lines).toEqual([[origin], [origin], [origin], [origin]]);
        expect(committed.matched.sessions).toEqual([
          expect.objectContaining({
            sessionId: sid,
            workspaceId: workspace.id,
            harness: "claude",
            archived: false,
            turns: [expect.objectContaining({ turnId, prompt: "total" })],
          }),
        ]);

        const forCommit = yield* (yield* Origins).forCommit(workspace.id, sha);
        expect(forCommit.map((s) => s.sessionId)).toEqual([sid]);

        const elsewhere = yield* (yield* Origins).match(
          "another-repository",
          query(committed.blamed)
        );

        expect(elsewhere.sessions).toEqual([]);
      })
    );
  }, 30_000);

  test("cherry-pick and squash keep the Origin; a human edit drops it", async () => {
    const repo = await makeRepo();

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        const turnId = yield* agentTurn(workspace, sid, "total");
        const origin = `${sid}:${turnId}`;
        const sha = yield* commitAll(repo, "Add computeTotal");

        // Onto another parent, so the picked commit gets a new SHA.
        yield* git(repo, "checkout", "-q", "-b", "picked", "HEAD~1");
        writeFileSync(join(repo, "notes.md"), "a commit before the pick\n");
        yield* commitAll(repo, "notes");
        yield* git(repo, "cherry-pick", sha);
        expect(yield* git(repo, "rev-parse", "HEAD")).not.toBe(sha);
        expect((yield* originsOf(workspace, "src/total.ts")).lines[0]).toEqual([origin]);

        yield* git(repo, "reset", "--soft", "HEAD~2");
        yield* git(repo, "commit", "-q", "-m", "squashed");
        expect((yield* originsOf(workspace, "src/total.ts")).lines[1]).toEqual([origin]);

        writeFileSync(
          join(repo, "src/total.ts"),
          TOTAL.replace("const total = items.reduce", "const total = values.reduce")
        );
        yield* commitAll(repo, "Rename to values");
        const edited = yield* originsOf(workspace, "src/total.ts");

        expect(edited.lines[0]).toEqual([origin]);
        expect(edited.lines[1]).toEqual([]);
      })
    );
  }, 30_000);

  test("a line committed before the Turn that wrote it again is not the Turn's", async () => {
    const repo = await makeRepo({ "src/old.ts": LABEL });
    const past = "2020-01-01T00:00:00Z";
    await gitText(repo, ["commit", "--amend", "-q", "--no-edit"], {
      config: "host",
      env: { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past },
    });

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        const turnId = yield* agentTurn(workspace, sid, "label");

        // The same line in the Turn's own (uncommitted) file is the Turn's.
        expect((yield* originsOf(workspace, "src/label.ts")).lines[0]).toEqual([
          `${sid}:${turnId}`,
        ]);
        expect((yield* originsOf(workspace, "src/old.ts")).lines[0]).toEqual([]);
      })
    );
  }, 30_000);

  test("pruned checkpoints and archiving keep Origins; removing the Workspace deletes them", async () => {
    const repo = await makeRepo();

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        const turnId = yield* agentTurn(workspace, sid, "total");
        yield* commitAll(repo, "Add computeTotal");

        yield* Effect.promise(() => dropSessionCheckpoints(repo, sid));
        expect(yield* Effect.promise(() => listCheckpointRefs(repo))).toEqual([]);
        const { blamed, lines } = yield* originsOf(workspace, "src/total.ts");
        expect(lines[0]).toEqual([`${sid}:${turnId}`]);

        yield* dispatch(
          Command.cases.ArchiveSession.make({ sessionId: sid, deleteMergedBranch: false })
        );
        yield* waitFor((m) => m.sessions.get(sid)?.session.state === "archived");
        const archived = yield* originsOf(workspace, "src/total.ts");
        expect(archived.lines[0]).toEqual([`${sid}:${turnId}`]);
        expect(archived.matched.sessions[0]?.archived).toBe(true);

        yield* dispatch(Command.cases.RemoveWorkspace.make({ workspaceId: workspace.id }));
        yield* waitFor((m) => !m.workspaces.has(workspace.id));
        const after = yield* (yield* Origins).match(blamed.repoKey, query(blamed));

        expect(after.lines.every((l) => l.origins.length === 0)).toBe(true);
        const store = yield* EventStore;
        expect((yield* store.origins.match(blamed.repoKey, [blamed.lines[0]!.hash!])).size).toBe(0);
      })
    );
  }, 30_000);

  test("deleting a session deletes its fingerprints", async () => {
    const repo = await makeRepo();

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        yield* agentTurn(workspace, sid, "total");
        const before = yield* originsOf(workspace, "src/total.ts");
        expect(before.matched.sessions).toHaveLength(1);

        yield* (yield* Origins).forgetSession(sid);
        expect((yield* originsOf(workspace, "src/total.ts")).matched.sessions).toEqual([]);
      })
    );
  }, 30_000);

  test("blame refuses a symlink out of the checkout; forCommit refuses an option for a sha", async () => {
    const repo = await makeRepo();
    const outside = join(tempDir(), "secret.txt");
    const written = join(tempDir(), "written.txt");

    writeFileSync(outside, "a secret line outside the checkout\n");
    symlinkSync(outside, join(repo, "link.txt"));

    await run(
      setup(repo),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        const origins = yield* Origins;
        const request = { workspaceId: workspace.id, startLine: 1, endLine: 10 };

        for (const [path, refusal] of [
          ["link.txt", "GitError"],
          ["src/../../secret.txt", "NotFound"],
        ]) {
          const blamed = yield* Effect.flip(origins.blame({ ...request, path: path! }));

          expect(blamed._tag).toBe(refusal!);
        }

        const refused = yield* Effect.flip(origins.forCommit(workspace.id, `--output=${written}`));

        expect(refused._tag).toBe("GitError");
        expect(existsSync(written)).toBe(false);
      })
    );
  }, 30_000);

  test("the upgrade's backfill fingerprints surviving checkpoints once", async () => {
    const repo = await makeRepo();
    const filename = join(tempDir(), "state.sqlite");
    let turnId: TurnId | undefined;

    await run(
      setup(repo, filename, false),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(repo);
        turnId = yield* agentTurn(workspace, sid, "total", false);
        const store = yield* EventStore;
        expect((yield* store.origins.indexedTurns([sid])).size).toBe(0);
      })
    );

    await run(
      setup(repo, filename),
      Effect.gen(function* () {
        const store = yield* EventStore;
        yield* waitIndexed(sid, turnId!);

        for (let i = 0; i < 500 && !(yield* store.origins.backfillDone); i++)
          yield* Effect.sleep("10 millis");
        expect(yield* store.origins.backfillDone).toBe(true);

        const model = yield* store.model;
        const workspace = [...model.workspaces.values()][0]!;
        expect((yield* originsOf(workspace, "src/total.ts")).lines[0]).toEqual([
          `${sid}:${turnId}`,
        ]);
      })
    );
  }, 30_000);
});
