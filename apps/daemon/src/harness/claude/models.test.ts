import { describe, expect, test } from "bun:test";
import { Model, SessionId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Scope } from "effect";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude, result } from "./fakeClaude.ts";
import { listClaudeModels } from "./models.ts";

const claudePath = () => "/opt/bin/claude";

describe("Claude Models", () => {
  test("lists what supportedModels() reports, from a claude that runs nothing else", async () => {
    const fake = new FakeClaude();

    fake.modelInfos = [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 5.5 · Best for everyday, complex tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      { value: "haiku", displayName: "Haiku 4.5", description: "" },
    ];

    const models = await Effect.runPromise(listClaudeModels({ query: fake.query, claudePath }));

    expect(models).toEqual([
      new Model({
        id: "default",
        name: "Default (recommended)",
        description: "Opus 5.5 · Best for everyday, complex tasks",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: null,
        isDefault: true,
      }),
      new Model({
        id: "haiku",
        name: "Haiku 4.5",
        description: null,
        efforts: [],
        defaultEffort: null,
        isDefault: false,
      }),
    ]);

    expect(fake.options).toMatchObject({
      pathToClaudeCodeExecutable: "/opt/bin/claude",
      persistSession: false,
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: ["user"],
      settings: { disableAllHooks: true },
    });
    expect(fake.inputs).toEqual([]);
    expect(fake.closed).toBe(true);
  });

  test("a missing claude fails listing without starting anything", async () => {
    const fake = new FakeClaude();

    const error = await Effect.runPromise(
      listClaudeModels({ query: fake.query, claudePath: () => null }).pipe(Effect.flip)
    );

    expect(error.message).toContain("not found");
    expect(fake.options).toBeNull();
  });

  test("a Turn switches the live query's Model and effort first, only when they change", async () => {
    const fake = new FakeClaude();
    const driver = makeClaudeDriver({ query: fake.query, claudePath });
    const scope = Effect.runSync(Scope.make());

    const session = await Effect.runPromise(
      driver
        .open({
          sessionId: SessionId.make("s1"),
          cwd: "/work",
          permissionMode: "supervised",
          model: "opus",
          effort: "high",
          resumeCursor: null,
        })
        .pipe(Scope.provide(scope))
    );

    expect(fake.options).toMatchObject({ model: "opus", effort: "high" });

    const send = (n: number, model: string | null, effort: string | null) =>
      Effect.runPromiseExit(
        session.sendTurn({
          turnId: TurnId.make(`t${n}`),
          prompt: "hi",
          attachments: [],
          model,
          effort,
        })
      );

    expect(Exit.isSuccess(await send(1, "opus", "high"))).toBe(true);
    expect([fake.models, fake.flagSettings]).toEqual([[], []]);
    // Claude answers the first Turn, so the session takes the next one.
    fake.emit(result([(await fake.nextInput(0)).uuid!]));
    await Bun.sleep(5);

    expect(Exit.isSuccess(await send(2, "sonnet", null))).toBe(true);
    expect(fake.models).toEqual(["sonnet"]);
    // Null goes back to the Model's default effort.
    expect(fake.flagSettings).toEqual([{ effortLevel: null }]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });

  test("an effort Claude Code doesn't have fails the Turn before anything is sent", async () => {
    const fake = new FakeClaude();
    const scope = Effect.runSync(Scope.make());

    const session = await Effect.runPromise(
      makeClaudeDriver({ query: fake.query, claudePath })
        .open({
          sessionId: SessionId.make("s1"),
          cwd: "/work",
          permissionMode: "supervised",
          model: null,
          effort: null,
          resumeCursor: null,
        })
        .pipe(Scope.provide(scope))
    );

    const error = await Effect.runPromise(
      session
        .sendTurn({
          turnId: TurnId.make("t1"),
          prompt: "hi",
          attachments: [],
          model: null,
          effort: "ultra",
        })
        .pipe(Effect.flip)
    );

    expect(error.message).toBe('Claude Code has no "ultra" effort level');
    expect(fake.inputs).toEqual([]);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
