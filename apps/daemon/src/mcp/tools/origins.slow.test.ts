/**
 * The `origins` and `read_history` tools end to end (ADR 0111): a fake Harness writes files in a
 * real repository, real Checkpoints and `Origins` fingerprint them, and the tools answer through MCP.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command, SessionId, SessionPlacement, type Workspace } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { CheckpointsLive } from "../../git/Checkpoints.ts";
import { gitText } from "../../git/git.ts";
import { makeRepo } from "../../git/testing.ts";
import { Engine } from "../../engine/Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../../engine/testing.ts";
import { Origins, OriginsConfig } from "../../origins/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { turnKey } from "../../store/origins.ts";
import { sessionOriginTools, sessionTools } from "../sessions/index.ts";
import { historyTools } from "./history.ts";
import type { BoundTool } from "./shared.ts";

const PROMPT = "Add a computeTotal helper that sums the cart";

const TOTAL = [
  "export function computeTotal(items: Array<number>) {",
  "  const total = items.reduce((sum, item) => sum + item, 0);",
  "  return total;",
  "}",
  "",
].join("\n");

const HUMAN = "export const greetingFromAPerson = 'hello, written by hand';\n";

const AGENT = SessionId.make("s-agent-writer");

const READER = SessionId.make("s-reader");

const layer = (repo: string) => {
  const claude = makeFakeDriver("claude", {
    onTurn: (input) => {
      if (input.prompt === PROMPT) {
        mkdirSync(dirname(join(repo, "src/total.ts")), { recursive: true });
        writeFileSync(join(repo, "src/total.ts"), TOTAL);
      }

      return completesTurns()(input);
    },
  });

  const engine = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [claude],
    checkpoints: CheckpointsLive,
  });

  return Layer.provideMerge(Origins.layer, engine).pipe(
    Layer.provide(Layer.succeed(OriginsConfig)({ backfillDelay: 0, backfillPause: 0 }))
  );
};

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const git = (repo: string, ...args: ReadonlyArray<string>) =>
  Effect.promise(() => gitText(repo, args, { config: "host" }));

const commitAll = (repo: string, message: string) =>
  Effect.gen(function* () {
    yield* git(repo, "add", "-A");
    yield* git(repo, "commit", "-q", "-m", message);

    return yield* git(repo, "rev-parse", "HEAD");
  });

const registerWorkspace = (repo: string) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

    return [...model.workspaces.values()].find((w) => w.path === repo)!;
  });

/** Runs `prompt` as the session's first Turn and waits until Origins has fingerprinted it. */
const firstTurn = (workspace: Workspace, sessionId: SessionId, prompt: string) =>
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
    const store = yield* EventStore;

    for (let i = 0; i < 1000; i++) {
      if ((yield* store.origins.indexedTurns([sessionId])).has(turnKey(sessionId, turnId)))
        return turnId;
      yield* Effect.sleep("10 millis");
    }

    return yield* Effect.die(new Error(`${turnId} was never fingerprinted`));
  });

/** The reader's catalog as the Daemon serves it: the call's text and whether it was an error. */
const toolsFor = (caller: SessionId) =>
  Effect.gen(function* () {
    const store = yield* EventStore;

    const tools = historyTools(caller, {
      ...sessionTools(store),
      origins: sessionOriginTools(store, yield* Origins),
    });

    return (name: string, input: Parameters<BoundTool["call"]>[0]) =>
      Effect.promise(async () => {
        const result = await tools.find((tool) => tool.name === name)!.call(input);

        return {
          error: result.isError === true,
          text: result.content.map((part) => ("text" in part ? part.text : "")).join("\n"),
        };
      });
  });

test("origins names the session and Turn behind agent lines, committed or not, and read_history opens that Turn", async () => {
  const repo = await makeRepo();

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* registerWorkspace(repo);
      const turnId = yield* firstTurn(workspace, AGENT, PROMPT);
      yield* firstTurn(workspace, READER, "What does computeTotal do?");
      const call = yield* toolsFor(READER);

      const uncommitted = yield* call("origins", { path: "src/total.ts", lines: "1-4" });

      expect(uncommitted.error).toBe(false);
      expect(uncommitted.text).toContain("- not committed: lines 1-4");
      expect(uncommitted.text).toContain(`${AGENT} · claude · idle · lines 1-4`);
      expect(uncommitted.text).toContain(`Turn 1 · ${turnId}`);
      expect(uncommitted.text).toContain(`prompt: "${PROMPT}"`);
      expect(uncommitted.text).toContain(`reply: "re: ${PROMPT}"`);
      expect(uncommitted.text).toContain(`read_history with turn (e.g. turn "${turnId}")`);
      expect(uncommitted.text).not.toContain(READER);

      const sha = yield* commitAll(repo, "Add computeTotal");
      const committed = yield* call("origins", { path: "src/total.ts" });

      expect(committed.text).toContain(`- ${sha.slice(0, 9)} "Add computeTotal"`);
      expect(committed.text).toContain(": lines 1-4");
      expect(committed.text).not.toContain("not committed");
      expect(committed.text).toContain(`Turn 1 · ${turnId}`);

      const byCommit = yield* call("origins", { commit: sha.slice(0, 10) });

      expect(byCommit.text).toContain(`Commit ${sha.slice(0, 10)}`);
      expect(byCommit.text).toContain(`${AGENT} · claude · idle`);
      expect(byCommit.text).toContain(`Turn 1 · ${turnId}`);

      writeFileSync(join(repo, "src/human.ts"), HUMAN);
      const humanSha = yield* commitAll(repo, "A greeting by hand");
      const human = yield* call("origins", { path: "src/human.ts", lines: "1" });

      expect(human.text).toContain(`- ${humanSha.slice(0, 9)} "A greeting by hand"`);
      expect(human.text).toContain("No Agent Session on this Host wrote these lines.");
      expect(human.text).not.toContain(AGENT);
      expect((yield* call("origins", { commit: humanSha })).text).toContain(
        "No Agent Session on this Host wrote the lines this commit added."
      );

      const turn = yield* call("read_history", { turn: turnId });

      expect(turn.error).toBe(false);
      expect(turn.text).toContain(`Session ${AGENT}`);
      expect(turn.text).toContain(`Turn ${turnId} is Turn 1 of 1`);
      expect(turn.text).toContain(`Prompt: ${PROMPT}`);
      expect(turn.text).toContain(`Assistant: re: ${PROMPT}`);
    }).pipe(Effect.provide(layer(repo)))
  );
}, 30_000);

test("origins refuses a path outside the checkout and input that names neither or both", async () => {
  const repo = await makeRepo();

  await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* registerWorkspace(repo);
      yield* firstTurn(workspace, READER, "hello there");
      const call = yield* toolsFor(READER);

      const outside = yield* call("origins", { path: "../../etc/passwd" });
      expect(outside.error).toBe(true);
      expect(outside.text).toContain("E-NOT-FOUND");

      for (const input of [{}, { path: "a.ts", commit: "abcd" }, { commit: "abcd", lines: "1" }]) {
        const refused = yield* call("origins", input);
        expect(refused.error).toBe(true);
        expect(refused.text).toContain("Give either path (with optional lines) or commit");
      }

      const backwards = yield* call("origins", { path: "a.ts", lines: "9-3" });
      expect(backwards.text).toContain("lines must be a range from 1");
    }).pipe(Effect.provide(layer(repo)))
  );
}, 30_000);
