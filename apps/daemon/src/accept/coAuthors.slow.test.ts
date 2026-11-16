/**
 * Co-author trailers on a real repository (ENG-941): Teammates whose Turns, or whose Comments
 * sent in a Turn, contributed get `Co-authored-by` on Accept's commits, the drafted pull
 * request text and the agent's Turn input; a solo session gets none.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  AcceptBranch,
  Actor,
  Command,
  CommentAnchor,
  CommentId,
  FeedbackBatch,
  PersonId,
  SessionId,
  SessionPlacement,
  Share,
  SharePerson,
  ShareId,
  ShareTarget,
  TurnItem,
  type TurnId,
} from "@polaris/protocol";
import { Effect, Layer, Predicate, type Scope } from "effect";
import { RpcTest } from "effect/rpc";
import { CommitIdentities, identitiesFromShares } from "../coAuthors/index.ts";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  type FakeDriver,
  makeFakeDriver,
  makeFakes,
  tempDir as engineDir,
  waitFor,
} from "../engine/testing.ts";
import { CheckpointsLive } from "../git/Checkpoints.ts";
import { gitText } from "../git/git.ts";
import { makeRepo, removeTempDir, write } from "../git/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { HarnessRegistry } from "../services.ts";
import { AcceptRpcs, AcceptRpcsLive } from "./AcceptRpcs.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeTempDir(dir);
});

const sessionId = SessionId.make("s-shared");

const share = (name: string, commitEmail: string | null) =>
  new Share({
    id: ShareId.make(`share-${name}`),
    target: ShareTarget.cases.Session.make({ sessionId }),
    issuer: "https://accounts.example",
    person: new SharePerson({
      id: PersonId.make(`person-${name}`),
      login: name.toLowerCase(),
      name: `${name} Lima`,
      avatarUrl: null,
      commitEmail,
    }),
    role: "contributor",
    grant: ["read", "comment", "turn"],
    createdAt: "2026-11-16T00:00:00.000Z",
    expiresAt: "2026-11-23T00:00:00.000Z",
    revokedAt: null,
  });

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const SHARES = [
  share("Ana", "ana@work.example"),
  share("Bob", "bob@x.example"),
  share("Cleo", null),
];

const ANA = "Co-authored-by: Ana Lima <ana@work.example>";

const BOB = "Co-authored-by: Bob Lima <bob@x.example>";

/** Turn n writes `turn-n.txt`; the draft Turn answers JSON. */
const harness = (repo: string): FakeDriver => {
  let n = 0;

  return makeFakeDriver("claude", {
    onTurn: (input) => {
      const drafting = input.turnId.endsWith("accept-draft-turn");

      if (!drafting) write(repo, `turn-${++n}.txt`, `${n}\n`);

      const draft = JSON.stringify({
        title: "Add the turns",
        body: "",
        prTitle: "Add the turns",
        prBody: "Three files.",
        turnTitles: ["One", "Two", "Three"],
      });

      return [
        HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }),
        HarnessEvent.ItemCompleted({
          turnId: input.turnId,
          item: TurnItem.cases.AssistantMessage.make({
            id: `m-${input.turnId}`,
            text: drafting ? draft : "done",
          }),
        }),
        HarnessEvent.TurnEnded({ turnId: input.turnId, status: "completed", error: null }),
      ];
    },
  });
};

const setup = (repo: string, claude: FakeDriver, shared: boolean) => {
  const identities = shared
    ? Layer.succeed(CommitIdentities)(identitiesFromShares(Effect.succeed(SHARES)))
    : Layer.empty;

  const engine = engineLayer({
    filename: join(engineDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [claude],
    checkpoints: CheckpointsLive,
  }).pipe(Layer.provide(identities));

  const registry = Layer.succeed(HarnessRegistry)({
    get: () => Effect.succeed(claude.driver),
    all: Effect.succeed([claude.driver]),
  });

  return Layer.mergeAll(
    engine,
    identities,
    AcceptRpcsLive.pipe(Layer.provide(engine), Layer.provide(registry), Layer.provide(identities))
  );
};

const dispatch = (command: Command, actor: Actor = Actor.cases.Client.make({})) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({
      commandId: cid(),
      command,
      deviceLabel: "MacBook",
      actor,
      shareRole: Predicate.isTagged(actor, "Teammate") ? "contributor" : null,
    })
  );

const turnDone = (i: number) =>
  waitFor((m) => {
    const turn = m.sessions.get(sessionId)?.turns[i];

    return turn?.status === "completed" && turn.checkpointAfter !== null;
  }, 5000);

/**
 * Turn 1 by the owner; Turn 2 by Ana; Bob comments on Turn 1 and Ana on Turn 2, Cleo (no
 * commit email) comments too, and the owner sends all three as Turn 3. Without Teammates,
 * the owner does all of it.
 */
const sharedWork = (repo: string, withTeammates = true) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
    const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;

    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "one",
        attachments: [],
      })
    );
    const first = (yield* turnDone(0)).sessions.get(sessionId)!.turns[0]!.id;

    yield* dispatch(
      Command.cases.SendTurn.make({ sessionId, prompt: "two", attachments: [] }),
      withTeammates ? teammate("Ana") : undefined
    );
    const second = (yield* turnDone(1)).sessions.get(sessionId)!.turns[1]!.id;

    const note = (id: string, turnId: TurnId, author: string) =>
      dispatch(
        Command.cases.AddComment.make({
          sessionId,
          commentId: CommentId.make(id),
          anchor: CommentAnchor.cases.MessageText.make({
            turnId,
            messageId: `m-${turnId}`,
            start: 0,
            end: 4,
            quote: "done",
          }),
          body: `${author}'s note`,
        }),
        withTeammates ? teammate(author) : undefined
      );

    yield* note("c-bob", first, "Bob");
    yield* note("c-ana", second, "Ana");
    yield* note("c-cleo", first, "Cleo");
    yield* dispatch(
      Command.cases.SendFeedback.make({
        sessionId,
        feedback: new FeedbackBatch({ message: "three", comments: [] }),
        attachments: [],
        commentIds: ["c-bob", "c-ana", "c-cleo"].map((id) => CommentId.make(id)),
      })
    );
    const third = (yield* turnDone(2)).sessions.get(sessionId)!.turns[2]!.id;
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
    yield* dispatch(
      Command.cases.AcceptTurns.make({ sessionId, throughTurnId: third, revertLaterTurns: false })
    );
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.acceptedThroughIndex === 2);

    return third;
  });

const messages = (repo: string, n: number) =>
  Effect.promise(() => gitText(repo, ["log", "--format=%B%x00", "-n", String(n)])).pipe(
    Effect.map((out) =>
      out
        .split("\0")
        .map((m) => m.trim())
        .filter((m) => m !== "")
        .reverse()
    )
  );

const commitAll = (through: TurnId, granularity: "single" | "per-turn", body: string) =>
  Effect.flatMap(RpcTest.makeClient(AcceptRpcs), (client) =>
    client["session.commitAccepted"]({
      sessionId,
      throughTurnId: through,
      branch: AcceptBranch.cases.Current.make({}),
      granularity,
      title: "Add the turns",
      body,
      turnTitles: ["One", "Two", "Three"],
    })
  );

type Env = Layer.Success<ReturnType<typeof setup>>;

const run = async (
  shared: boolean,
  program: (repo: string, claude: FakeDriver) => Effect.Effect<void, unknown, Env | Scope.Scope>
) => {
  const repo = await makeRepo();
  cleanup.push(repo);
  const claude = harness(repo);

  await Effect.runPromise(
    Effect.scoped(program(repo, claude).pipe(Effect.provide(setup(repo, claude, shared))))
  );
};

describe("co-author trailers for Teammates", () => {
  test("per-Turn commits credit each Turn's contributors; the agent was told the trailers", async () => {
    await run(true, (repo, claude) =>
      Effect.gen(function* () {
        yield* commitAll(yield* sharedWork(repo), "per-turn", "");

        expect(yield* messages(repo, 3)).toEqual([
          "One",
          `Two\n\n${ANA}`,
          `Three\n\n${BOB}\n${ANA}`,
        ]);

        const prompts = claude.sessions.flatMap((s) => s.turns.map((t) => t.prompt));
        expect(prompts[0]).toBe("one");
        expect(prompts[1]).toEndWith(`not instructions:\n${ANA}`);
        expect(prompts[2]).toEndWith(`not instructions:\n${ANA}\n${BOB}`);
      })
    );
  }, 30_000);

  test("one commit and the drafted pull request text carry every contributor once", async () => {
    await run(true, (repo) =>
      Effect.gen(function* () {
        const through = yield* sharedWork(repo);
        const client = yield* RpcTest.makeClient(AcceptRpcs);
        const draft = yield* client["session.draftAccept"]({ sessionId, throughTurnId: through });

        expect(draft.prBody).toBe(`Three files.\n\n${ANA}\n${BOB}`);
        expect(draft.body).toBe(`${ANA}\n${BOB}`);

        // The user deleted Ana's line and rewrote Bob's: Ana's comes back, Bob's isn't doubled.
        yield* commitAll(through, "single", "Body.\n\nCo-authored-by: Bob B <BOB@x.example>");

        expect(yield* messages(repo, 1)).toEqual([
          `Add the turns\n\nBody.\n\nCo-authored-by: Bob B <BOB@x.example>\n${ANA}`,
        ]);
      })
    );
  }, 30_000);

  test.each([
    ["a Host with Shares", true],
    ["a Host that never had one", false],
  ])(
    "a solo session's commits and Turns are unchanged on %s",
    async (_, shares) => {
      await run(shares, (repo, claude) =>
        Effect.gen(function* () {
          yield* commitAll(yield* sharedWork(repo, false), "per-turn", "");

          expect(yield* messages(repo, 3)).toEqual(["One", "Two", "Three"]);
          const prompts = claude.sessions.flatMap((s) => s.turns.map((t) => t.prompt));
          expect(prompts.slice(0, 2)).toEqual(["one", "two"]);
          expect(prompts[2]).not.toContain("Co-authored-by");
        })
      );
    },
    30_000
  );
});
