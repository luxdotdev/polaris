import { describe, expect, test } from "bun:test";
import { AttachmentId, Command } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { type ThreadController, type ThreadState, openThread } from "./controller.ts";
import {
  checkpoint,
  ended,
  type FakeHost,
  type FakeHostOptions,
  finding,
  makeFakeHost,
  sessionId,
  snapshot,
  stateChanged,
  summaryAt,
  turn,
} from "./daemon.testing.ts";
import { daemonThreadSource } from "./source.ts";

const ALL = new Set(["session.steer", "session.continuity", "review.risk-summary"]);

/** Waits for the controller's state to satisfy `ok`, or fails naming what it last held. */
const until = (thread: ThreadController, ok: (state: ThreadState) => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      if (ok(thread.get())) return thread.get();
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }

    return yield* Effect.die(new Error(`never reached; held ${JSON.stringify(thread.get())}`));
  });

const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 40)));

const withThread = (
  run: (host: FakeHost, thread: ThreadController) => Effect.Effect<void>,
  options: FakeHostOptions & { readonly capabilities?: ReadonlySet<string> } = {}
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* makeFakeHost(options);

        const source = daemonThreadSource({
          live: host.live,
          capabilities: options.capabilities ?? ALL,
        });

        const thread = openThread(source, sessionId, { draftDelayMs: 10 });

        yield* Effect.ensuring(
          run(host, thread),
          Effect.sync(() => thread.dispose())
        );
      })
    )
  );

const working = turn(1, { status: "working", endedAt: null });

describe("drafts follow the session", () => {
  test("'Draft saved' shows only once the Host acknowledges the write", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* until(thread, (s) => s.fold !== null);
        yield* settle;
        host.holdSaves();
        thread.type("Read the token from the env");
        yield* until(thread, (s) => s.draftStatus === "saving");
        yield* settle;
        expect(thread.get().draftStatus).toBe("saving");
        yield* host.release();
        yield* until(thread, (s) => s.draftStatus === "saved");
      })
    ));

  test("a draft saved on another Client replaces the phone's idle composer", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* settle;
        yield* host.saveElsewhere("typed on the Mac");
        yield* until(thread, (s) => s.text === "typed on the Mac");
      })
    ));

  test("a draft that failed to save is written again when the Host reconnects", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* settle;
        host.failNextSave();
        thread.type("written offline");
        yield* until(thread, (s) => s.draftStatus === "unsaved");

        thread.reconnected();
        yield* until(thread, (s) => s.draftStatus === "saved");
      })
    ));

  test("a Host without continuity never claims a draft is saved", () =>
    withThread(
      (host, thread) =>
        Effect.gen(function* () {
          yield* host.push(snapshot([{ turn: turn(0) }]));
          yield* settle;
          thread.type("not synced");
          yield* settle;
          expect(thread.get().draftStatus).toBeNull();
        }),
      { capabilities: new Set(["session.steer"]) }
    ));
});

describe("read position", () => {
  test("reports the newest ended Turn on screen, skips a working one, and never goes back", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }, { turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        yield* settle;
        thread.seen(["t-0", "t-1"]);
        yield* settle;
        thread.seen(["t-0"]);
        yield* settle;
        expect(host.reads).toEqual([0]);
      })
    ));
});

describe("send, steer, queue", () => {
  test("Send steers the Turn in flight when the Host can steer", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("use the env var");
        yield* Effect.promise(() => thread.submit());
        expect(host.commands.map((c) => c._tag)).toEqual(["Steer"]);
        expect(thread.get().text).toBe("");
      })
    ));

  test("a queued follow-up goes as the next Turn only after the Turn in flight ends", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("then rerun the tests");
        thread.queue();
        yield* settle;
        expect(host.commands).toEqual([]);
        expect(thread.get().queued).toEqual([{ text: "then rerun the tests", attachments: [] }]);

        yield* host.push(ended(2, turn(1)));
        yield* host.push(stateChanged(3, "idle"));
        yield* until(thread, (s) => s.queued.length === 0);
        const sent = host.commands[0];
        expect(Predicate.isTagged(sent, "SendTurn") && sent.prompt).toBe("then rerun the tests");
      })
    ));

  test("Send with attachments during a steerable Turn waits for it, since a steer is text only", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        const shot = AttachmentId.make("att-1");

        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("use this screenshot");
        expect(yield* Effect.promise(() => thread.submit([shot]))).toBe(true);
        yield* settle;
        expect(host.commands).toEqual([]);

        yield* host.push(ended(2, turn(1)));
        yield* host.push(stateChanged(3, "idle"));
        yield* until(thread, (s) => s.queued.length === 0);
        expect(host.commands[0]).toEqual(
          Command.cases.SendTurn.make({
            sessionId,
            prompt: "use this screenshot",
            attachments: [shot],
          })
        );
      })
    ));
});

describe("the Critical finding", () => {
  const head = "c0ffee";
  const ref = "refs/polaris/checkpoints/s-1/t-1/after";

  test("comes from the summary cached at the last ended Turn's checkpoint", () =>
    withThread(
      (host, thread) =>
        Effect.gen(function* () {
          yield* host.push(snapshot([{ turn: working }], { state: "working" }));
          yield* until(thread, (s) => s.fold !== null);
          yield* host.push(checkpoint(2, 1, ref, head));
          yield* host.push(ended(3, turn(1, { checkpointAfter: ref })));
          const state = yield* until(thread, (s) => s.findings.length > 0);
          expect(state.findings.map((f) => f.title)).toEqual(["Secret-like value committed"]);
          expect(host.summariesAsked).toContain(head);
        }),
      { summaries: new Map([[head, summaryAt(head, [finding()])]]) }
    ));

  test("is absent when no summary is cached, and nothing starts one", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        yield* host.push(checkpoint(2, 1, ref, head));
        yield* host.push(ended(3, turn(1, { checkpointAfter: ref })));
        yield* until(thread, () => host.summariesAsked.includes(head));
        yield* settle;
        expect(thread.get().findings).toEqual([]);
      })
    ));
});
