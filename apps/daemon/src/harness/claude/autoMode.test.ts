import { expect, test } from "bun:test";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { SessionId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Result, Scope, Stream } from "effect";
import { HarnessEvent, type OpenOptions } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude, init, status } from "./fakeClaude.ts";

const info = (value: string, supportsAutoMode?: boolean): ModelInfo => {
  const row: ModelInfo = {
    value,
    displayName: value,
    description: "",
    resolvedModel: `claude-${value}`,
  };

  if (supportsAutoMode !== undefined) row.supportsAutoMode = supportsAutoMode;

  return row;
};

const options: OpenOptions = {
  sessionId: SessionId.make("worker:session"),
  cwd: "/work/repo",
  model: "sonnet",
  effort: null,
  permissionMode: "auto",
  resumeCursor: null,
};

const driverFor = (fake: FakeClaude) =>
  makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
  });

test("dispatch permission preflight refuses Haiku without sending a Turn or persisting a session", async () => {
  const fake = new FakeClaude();
  fake.modelInfos = [info("haiku", false)];

  const outcome = await Effect.runPromise(
    Effect.result(driverFor(fake).validatePermissionMode!({ ...options, model: "haiku" }))
  );

  expect(Result.isFailure(outcome) && outcome.failure.message).toBe(
    "Claude model haiku does not support the auto permission mode."
  );
  expect(fake.inputs).toEqual([]);
  expect(fake.permissionModes).toEqual([]);
  expect(fake.options?.persistSession).toBe(false);
  expect(fake.options?.mcpServers).toEqual({});
  expect(fake.closed).toBe(true);
});

test("preflight resolves aliases, canonical models and default using advertised capabilities", async () => {
  for (const model of ["sonnet", "claude-sonnet", null]) {
    const fake = new FakeClaude();
    fake.modelInfos = [info("sonnet", true), info("default", true)];
    await Effect.runPromise(driverFor(fake).validatePermissionMode!({ ...options, model }));
    expect(fake.permissionModes).toEqual(["auto"]);
    expect(fake.inputs).toEqual([]);
    expect(fake.closed).toBe(true);
  }
});

test("missing capability metadata is a visible refusal, and supervised mode needs no probe", async () => {
  const fake = new FakeClaude();
  fake.modelInfos = [info("sonnet")];
  const driver = driverFor(fake);
  const outcome = await Effect.runPromise(Effect.result(driver.validatePermissionMode!(options)));
  expect(Result.isFailure(outcome) ? outcome.failure.message : "").toContain(
    "could not verify auto support"
  );
  const supervised = new FakeClaude();
  await Effect.runPromise(
    driverFor(supervised).validatePermissionMode!({ ...options, permissionMode: "supervised" })
  );
  expect(supervised.options).toBeNull();
});

test("live auto guard refuses unsupported resume, model switch and mode switch before user input", async () => {
  const fake = new FakeClaude();
  fake.modelInfos = [info("sonnet", true), info("haiku", false)];
  const scope = Effect.runSync(Scope.make());

  try {
    const driver = driverFor(fake);

    const unsupported = await Effect.runPromise(
      Effect.result(
        driver
          .open({ ...options, model: "haiku", resumeCursor: "cursor" })
          .pipe(Scope.provide(scope))
      )
    );

    expect(Result.isFailure(unsupported)).toBe(true);
    expect(fake.inputs).toEqual([]);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }

  const running = new FakeClaude();
  running.modelInfos = [info("sonnet", true), info("haiku", false)];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* driverFor(running).open(options);

        const switchResult = yield* Effect.result(
          session.sendTurn({
            turnId: TurnId.make("turn"),
            prompt: "edit",
            attachments: [],
            model: "haiku",
            effort: null,
          })
        );

        expect(Result.isFailure(switchResult)).toBe(true);
        expect(running.models).toEqual([]);
        expect(running.inputs).toEqual([]);
      })
    )
  );

  const supervised = new FakeClaude();
  supervised.modelInfos = [info("haiku", false)];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* driverFor(supervised).open({
          ...options,
          model: "haiku",
          permissionMode: "supervised",
        });

        expect(Result.isFailure(yield* Effect.result(session.setPermissionMode("auto")))).toBe(
          true
        );
        expect(supervised.permissionModes).toEqual([]);
      })
    )
  );
});

test("a resumed binary reporting Manual instead of auto fails explicitly without an approval", async () => {
  const fake = new FakeClaude();
  fake.modelInfos = [info("sonnet", true)];
  const events: HarnessEvent[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* driverFor(fake).open({ ...options, resumeCursor: "cursor" });
        yield* session.sendTurn({
          turnId: TurnId.make("turn"),
          prompt: "edit",
          attachments: [],
          model: "sonnet",
          effort: null,
        });
        fake.emit(init("cursor", "default"));
        yield* Stream.runForEach(session.events, (event) =>
          Effect.sync(() => {
            events.push(event);
          })
        );
      })
    )
  );
  const ended = events.find(HarnessEvent.$is("TurnEnded"));

  expect(ended?.status).toBe("failed");
  expect(ended?.error).toContain("instead of auto");
  expect(events.some((event) => HarnessEvent.$is("ApprovalRequested")(event))).toBe(false);
  expect(fake.closed).toBe(true);
});

test("read-only Reviewer keeps dontAsk even with an auto Session", async () => {
  const fake = new FakeClaude();
  await Effect.runPromise(
    Effect.scoped(driverFor(fake).open({ ...options, model: "haiku", readOnly: true }))
  );
  expect(fake.options?.permissionMode).toBe("dontAsk");
});

test("metadata and Workspace mode refusals close the preflight child without a Turn", async () => {
  for (const refused of ["supportedModels", "setPermissionMode"] as const) {
    const fake = new FakeClaude();
    fake.modelInfos = [info("sonnet", true)];
    fake.refuses.add(refused);

    const result = await Effect.runPromise(
      Effect.result(driverFor(fake).validatePermissionMode!(options))
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(fake.inputs).toEqual([]);
    expect(fake.closed).toBe(true);
  }
});

test("an intentional change from auto accepts status arriving before the control reply", async () => {
  const fake = new FakeClaude();
  fake.modelInfos = [info("sonnet", true)];

  const driver = makeClaudeDriver({
    claudePath: () => "/opt/bin/claude",
    query: (params) => {
      const q = fake.query(params);
      q.setPermissionMode = async (mode) => {
        fake.emit(status(mode));
        await Bun.sleep(5);
      };

      return q;
    },
  });

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* driver.open(options);
        yield* session.setPermissionMode("supervised");
        expect(fake.closed).toBe(false);
        yield* session.sendTurn({
          turnId: TurnId.make("turn"),
          prompt: "edit",
          attachments: [],
          model: "haiku",
          effort: null,
        });
      })
    )
  );
});
