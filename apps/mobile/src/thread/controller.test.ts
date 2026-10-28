import { describe, expect, test } from "bun:test";
import {
  ApprovalDecision,
  AttachmentId,
  Command,
  DomainEvent,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { type ThreadController, type ThreadState, openThread } from "./controller.ts";
import {
  at,
  checkpoint,
  ended,
  event,
  type FakeHost,
  type FakeHostOptions,
  finding,
  makeFakeHost,
  request,
  sessionId,
  snapshot,
  stateChanged,
  summaryAt,
  turn,
} from "./daemon.testing.ts";
import { daemonThreadSource } from "./source.ts";
import { makeThreadRegistry } from "./threads.ts";

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

const allow = ApprovalDecision.cases.Allow.make({ remember: false });

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

describe("a steer shows until it lands", () => {
  const landed = (sequence: number, text: string) =>
    event(
      sequence,
      DomainEvent.cases.TurnItemCompleted.make({
        sessionId,
        turnId: TurnId.make("t-1"),
        item: TurnItem.cases.UserMessage.make({ id: `u-${sequence}`, text, startedAt: at }),
        subagentId: null,
      })
    );

  const steering = (thread: ThreadController) =>
    thread.get().steers.map((entry) => `${entry.status}: ${entry.text}`);

  test("in the thread at once, then gone once the Harness takes it in", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        host.holdDispatches();
        thread.type("use the env var");
        const taken = thread.submit();
        yield* settle;
        expect(steering(thread)).toEqual(["sending: use the env var"]);
        expect(thread.get().text).toBe("");

        yield* host.releaseDispatches();
        yield* Effect.promise(() => taken);
        expect(steering(thread)).toEqual(["sent: use the env var"]);
        expect(thread.busy()).toBe(true);

        yield* host.push(landed(2, "use the env var"));
        yield* until(thread, (s) => s.steers.length === 0);
      })
    ));

  test("fails when the Turn ends first, and goes back to the composer to send again", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: working }], { state: "working" }));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("also run lint");
        yield* Effect.promise(() => thread.submit());

        yield* host.push(ended(2, turn(1)));
        const failed = yield* until(thread, (s) => s.steers[0]?.status === "failed");
        expect(failed.steers[0]?.error).toBe("The turn ended before it landed");

        thread.editSteer(failed.steers[0]?.id ?? "");
        expect(thread.get().steers).toEqual([]);
        expect(thread.get().text).toBe("also run lint");
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

describe("pending requests", () => {
  const long = Array.from({ length: 8 }, (_, i) => `step ${i} && echo ${"x".repeat(60)}`).join(
    "\n"
  );

  test("a long command Home can't approve inline is answered in the thread, once", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        const asked = request({ detail: long });
        yield* host.push(snapshot([{ turn: working }], { state: "needs-you" }, [asked]));
        const state = yield* until(thread, (s) => s.fold !== null);
        expect(state.fold?.pendingApprovals.map((r) => r.detail)).toEqual([long]);

        host.holdDispatches();
        const first = thread.respond(asked.id, allow);
        const second = thread.respond(asked.id, allow);
        expect(thread.get().answering).toEqual([asked.id]);
        yield* host.releaseDispatches();
        yield* Effect.promise(() => Promise.all([first, second]));

        const sent = host.commands.filter((c) => Predicate.isTagged(c, "RespondToApproval"));
        expect(sent.length).toBe(1);
        expect(Predicate.isTagged(sent[0], "RespondToApproval") && sent[0].requestId).toBe(
          asked.id
        );
        expect(thread.get().answering).toEqual([]);
      })
    ));
});

describe("one submission, one command", () => {
  test("text typed after Send survives the send's acknowledgement and is saved", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* until(thread, (s) => s.fold !== null);
        yield* settle;
        thread.type("message A");
        host.holdDispatches();
        const sending = thread.submit();
        yield* settle;
        thread.type("draft B");
        yield* host.releaseDispatches();
        yield* Effect.promise(() => sending);
        yield* settle;

        expect(host.commands.length).toBe(1);
        expect(thread.get().text).toBe("draft B");
        expect(host.saved.at(-1)).toBe("draft B");
      })
    ));

  test("Return and the Send button before the Host answers make one Turn", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("run the tests");
        host.holdDispatches();
        const keyboard = thread.submit();
        const button = thread.submit();
        yield* host.releaseDispatches();
        yield* Effect.promise(() => Promise.all([keyboard, button]));
        expect(host.commands.map((c) => c._tag)).toEqual(["SendTurn"]);
      })
    ));

  test("a retry after a lost answer reuses the command id; a new message gets its own", () =>
    withThread((host, thread) =>
      Effect.gen(function* () {
        yield* host.push(snapshot([{ turn: turn(0) }]));
        yield* until(thread, (s) => s.fold !== null);
        thread.type("run the tests");
        host.dropNextAnswer();
        yield* Effect.promise(() => thread.submit());
        expect(thread.get().error).not.toBeNull();
        expect(thread.get().text).toBe("run the tests");

        yield* Effect.promise(() => thread.submit());
        thread.type("then lint");
        yield* Effect.promise(() => thread.submit());
        const [first, retry, next] = host.commandIds;
        expect(retry).toBe(first);
        expect(next).not.toBe(first);
      })
    ));
});

describe("the thread outlives its screen", () => {
  test("queued follow-ups survive the screen letting go and coming back", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeFakeHost();
          const registry = makeThreadRegistry();
          const source = daemonThreadSource({ live: host.live, capabilities: ALL });
          let opened = 0;

          const open = () => {
            opened++;

            return openThread(source, sessionId, { draftDelayMs: 10 });
          };

          const first = registry.acquire("h/s-1", open);
          yield* host.push(snapshot([{ turn: working }], { state: "working" }));
          yield* until(first!.controller, (s) => s.fold !== null);
          first!.controller.type("then rerun the tests");
          first!.controller.queue();
          first!.release();

          // A reconnect or a deliberate Back: the screen comes again for the same Host and session.
          const again = registry.acquire("h/s-1", null);
          expect(again?.controller.get().queued).toEqual([
            { text: "then rerun the tests", attachments: [] },
          ]);
          expect(again?.controller.get().fold).not.toBeNull();
          again!.release();

          yield* host.push(ended(2, turn(1)));
          yield* host.push(stateChanged(3, "idle"));
          yield* until(again!.controller, (s) => s.queued.length === 0);
          yield* settle;
          expect(host.commands.map((c) => c._tag)).toEqual(["SendTurn"]);

          // Nothing pending and no screen: closed, so the next screen opens a fresh one.
          expect(registry.acquire("h/s-1", null)).toBeNull();
          registry.acquire("h/s-1", open)?.release();
          expect(opened).toBe(2);
        })
      )
    ));
});

describe("a follow-up keeps its thread until it lands", () => {
  test("a follow-up whose answer is lost after the screen let go is still queued for retry", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeFakeHost();
          const registry = makeThreadRegistry();
          const source = daemonThreadSource({ live: host.live, capabilities: ALL });
          const open = () => openThread(source, sessionId, { draftDelayMs: 10 });

          const first = registry.acquire("h/s-1", open);
          yield* host.push(snapshot([{ turn: working }], { state: "working" }));
          yield* until(first!.controller, (s) => s.fold !== null);
          first!.controller.type("then rerun the tests");
          first!.controller.queue();
          first!.release();

          host.dropNextAnswer();
          yield* host.push(ended(2, turn(1)));
          yield* host.push(stateChanged(3, "idle"));
          yield* until(first!.controller, (s) => s.error !== null);
          yield* settle;

          const again = registry.acquire("h/s-1", null);
          expect(again?.controller).toBe(first!.controller);
          expect(again?.controller.get().queued).toEqual([
            { text: "then rerun the tests", attachments: [] },
          ]);
          again?.release();
        })
      )
    ));
});
