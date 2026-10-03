import { expect, test } from "bun:test";
import { Attachment, AttachmentId, SessionId, TurnId, TurnItem } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { assistant, FakeClaude, result } from "./fakeClaude.ts";

const gate = () => {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release: () => release() };
};

test.each(["controls", "attachments"])(
  "a parent run during user input preparation (%s) cannot close or replace that Turn",
  async (preparation) => {
    const fake = new FakeClaude();
    const entered = gate();
    const ready = gate();
    const scope = Effect.runSync(Scope.make());

    const session = await Effect.runPromise(
      makeClaudeDriver({
        query: (options) => {
          const query = fake.query(options);
          const setModel = query.setModel.bind(query);
          query.setModel = async (model) => {
            entered.release();
            await ready.promise;

            return setModel(model);
          };

          return query;
        },
        claudePath: () => "/opt/bin/claude",
        readFile: async () => {
          entered.release();
          await ready.promise;

          return new Uint8Array([137, 80, 78, 71]);
        },
      })
        .open({
          sessionId: SessionId.make("s1"),
          cwd: "/work/repo",
          permissionMode: "full-access",
          model: null,
          effort: null,
          resumeCursor: null,
        })
        .pipe(Scope.provide(scope))
    );

    const events: HarnessEvent[] = [];
    Effect.runFork(
      Stream.runForEach(session.events, (event) => Effect.sync(() => events.push(event)))
    );
    const turnId = TurnId.make("prepared-user");

    const sending = Effect.runPromise(
      session.sendTurn({
        turnId,
        prompt: "Check this",
        model: preparation === "controls" ? "sonnet" : null,
        effort: null,
        attachments:
          preparation === "attachments"
            ? [
                new Attachment({
                  id: AttachmentId.make("a1"),
                  name: "shot.png",
                  mimeType: "image/png",
                  size: 4,
                  hostPath: "/stage/shot.png",
                  width: null,
                  height: null,
                }),
              ]
            : [],
      })
    );

    try {
      await entered.promise;
      fake.emit(assistant("native", [{ type: "text", text: "Background report." }]));
      fake.emit({ ...result([]), origin: { kind: "task-notification" } });
      await fake.waitProcessed();
      await Bun.sleep(5);
      expect(events.filter(HarnessEvent.$is("TurnStarted"))).toMatchObject([{ turnId }]);
      expect(events.filter(HarnessEvent.$is("TurnEnded"))).toHaveLength(0);
      expect(
        events.find(
          (event) =>
            HarnessEvent.$is("ItemCompleted")(event) && TurnItem.guards.AssistantMessage(event.item)
        )
      ).toMatchObject({ turnId });
      ready.release();
      await sending;
      const input = await fake.nextInput(0);
      fake.emit(result([input.uuid!]));
      await fake.waitProcessed();
      await Bun.sleep(5);
      expect(events.filter(HarnessEvent.$is("TurnStarted"))).toHaveLength(1);
      expect(events.filter(HarnessEvent.$is("TurnEnded"))).toMatchObject([
        { turnId, status: "completed" },
      ]);
    } finally {
      ready.release();
      await sending;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
);

test.each(["validation", "attachments"])(
  "failed preparation (%s) releases the Turn for the next prompt and native run",
  async (failure) => {
    const fake = new FakeClaude();
    fake.modelInfos = [
      { value: "default", displayName: "Default", description: "Fixture", supportsAutoMode: true },
      { value: "sonnet", displayName: "Sonnet", description: "Fixture", supportsAutoMode: false },
    ];
    const scope = Effect.runSync(Scope.make());

    const session = await Effect.runPromise(
      makeClaudeDriver({
        query: fake.query,
        claudePath: () => "/opt/bin/claude",
        readFile: async () => {
          throw new Error("Fixture attachment read failed");
        },
      })
        .open({
          sessionId: SessionId.make("s1"),
          cwd: "/work/repo",
          permissionMode: failure === "validation" ? "auto" : "full-access",
          model: null,
          effort: null,
          resumeCursor: null,
        })
        .pipe(Scope.provide(scope))
    );

    const events: HarnessEvent[] = [];
    Effect.runFork(
      Stream.runForEach(session.events, (event) => Effect.sync(() => events.push(event)))
    );

    try {
      const failedId = TurnId.make("failed-preparation");

      const error = await Effect.runPromise(
        session
          .sendTurn({
            turnId: failedId,
            prompt: "Fails",
            model: failure === "validation" ? "sonnet" : null,
            effort: null,
            attachments:
              failure === "attachments"
                ? [
                    new Attachment({
                      id: AttachmentId.make("a1"),
                      name: "shot.png",
                      mimeType: "image/png",
                      size: 4,
                      hostPath: "/stage/shot.png",
                      width: null,
                      height: null,
                    }),
                  ]
                : [],
          })
          .pipe(Effect.flip)
      );

      expect(error.message).toContain(failure === "validation" ? "does not support" : "attachment");
      expect(fake.inputs).toHaveLength(0);
      const nextId = TurnId.make("next-prompt");
      await Effect.runPromise(
        session.sendTurn({
          turnId: nextId,
          prompt: "Works",
          model: null,
          effort: null,
          attachments: [],
        })
      );
      const input = await fake.nextInput(0);
      fake.emit(result([input.uuid!]));
      await fake.waitProcessed();
      fake.emit(assistant("native", [{ type: "text", text: "Native run works too." }]));
      fake.emit({ ...result([]), origin: { kind: "task-notification" } });
      await fake.waitProcessed();
      await Bun.sleep(5);
      expect(events.filter(HarnessEvent.$is("TurnStarted"))).toHaveLength(3);
      expect(events.filter(HarnessEvent.$is("TurnEnded"))).toMatchObject([
        { turnId: failedId, status: "failed" },
        { turnId: nextId, status: "completed" },
        { status: "completed" },
      ]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  }
);

test("steering declines an ended Turn and never reuses its id for a user Turn", async () => {
  const fake = new FakeClaude();
  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    makeClaudeDriver({ query: fake.query, claudePath: () => "/opt/bin/claude" })
      .open({
        sessionId: SessionId.make("s1"),
        cwd: "/work/repo",
        permissionMode: "full-access",
        model: null,
        effort: null,
        resumeCursor: null,
      })
      .pipe(Scope.provide(scope))
  );

  try {
    fake.emit(assistant("native", [{ type: "text", text: "Finished." }]));
    fake.emit({ ...result([]), origin: { kind: "task-notification" } });
    await fake.waitProcessed();

    const sent = await Effect.runPromise(
      session.steerTurn!({
        turnId: TurnId.make("ended"),
        prompt: "Do this next",
        attachments: [],
        model: null,
        effort: null,
      })
    );

    expect(sent).toBe(false);
    expect(fake.inputs).toHaveLength(0);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
