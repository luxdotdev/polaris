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
