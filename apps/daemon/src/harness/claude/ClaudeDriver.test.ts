import { describe, expect, test } from "bun:test";
import {
  ApprovalDecision,
  Attachment,
  AttachmentId,
  SessionId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent, type OpenOptions } from "../HarnessDriver.ts";
import { type ClaudeDriverOptions, makeClaudeDriver, parseVersion } from "./ClaudeDriver.ts";
import { assistant, FakeClaude, init, result, streamEvent, toolResult } from "./fakeClaude.ts";

const T1 = TurnId.make("turn-1");

const T2 = TurnId.make("turn-2");

const openFake = async (
  overrides: Partial<OpenOptions> = {},
  driverOptions: ClaudeDriverOptions = {}
) => {
  const fake = new FakeClaude();

  const driver = makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
    readFile: async () => new Uint8Array([137, 80, 78, 71]),
    ...driverOptions,
  });

  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    driver
      .open({
        sessionId: SessionId.make("session-1"),
        cwd: "/work/repo",
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor: null,
        ...overrides,
      })
      .pipe(Scope.provide(scope))
  );

  const events: HarnessEvent[] = [];
  let ended = false;
  Effect.runFork(
    Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(e))).pipe(
      Effect.ensuring(Effect.sync(() => (ended = true)))
    )
  );

  const until = async (predicate: () => boolean, label = "condition") => {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return;
      await Bun.sleep(2);
    }

    throw new Error(`timed out waiting for ${label}; events: ${JSON.stringify(events, null, 1)}`);
  };

  const has = (tag: HarnessEvent["_tag"]) => () => events.some(HarnessEvent.$is(tag));

  /** The first event with this tag; fails the test when there is none. */
  const first = <T extends HarnessEvent["_tag"]>(tag: T) => {
    const event = events.find(HarnessEvent.$is(tag));

    if (event === undefined) throw new Error(`no ${tag} event`);

    return event;
  };

  return {
    fake,
    session,
    events,
    until,
    has,
    first,
    isEnded: () => ended,
    run: <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

const turn = (turnId: TurnId, prompt: string, attachments: Attachment[] = []) => ({
  turnId,
  prompt,
  attachments,
  model: null,
  effort: null,
});

const inputUuid = (m: { uuid?: string }) => m.uuid!;

describe("Claude driver", () => {
  test("starts the user's claude with streaming input and the mapped options", async () => {
    const t = await openFake({ permissionMode: "auto-edits", model: "haiku" });
    const o = t.fake.options!;
    expect(o.pathToClaudeCodeExecutable).toBe("/opt/bin/claude");
    expect(o.cwd).toBe("/work/repo");
    expect(o.permissionMode).toBe("acceptEdits");
    expect(o.model).toBe("haiku");
    expect(o.includePartialMessages).toBe(true);
    expect(o.resume).toBeUndefined();
    expect(o.additionalDirectories).toEqual(["/tmp/polaris-staging/session-1"]);
    await t.close();
  });

  test("a full Turn with text streaming, tool use, a file edit and a plan", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "list files")));
    const sent = await t.fake.nextInput(0);
    expect(sent.message.content).toEqual([{ type: "text", text: "list files" }]);

    t.fake.emit(init("claude-session-1"));
    t.fake.emit(streamEvent({ type: "message_start", message: { id: "m1" } }));
    t.fake.emit(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Look" },
      })
    );
    t.fake.emit(assistant("m1", [{ type: "text", text: "Looking." }]));
    t.fake.emit(
      assistant("m1", [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }])
    );
    t.fake.emit(
      toolResult("tu1", "a\nb", { structured: { stdout: "a\nb", stderr: "", interrupted: false } })
    );
    t.fake.emit(
      assistant("m2", [
        { type: "tool_use", id: "tu2", name: "Write", input: { file_path: "/work/repo/x.ts" } },
      ])
    );
    t.fake.emit(toolResult("tu2", "ok", { structured: { type: "create", filePath: "x.ts" } }));
    t.fake.emit(
      assistant("m3", [
        {
          type: "tool_use",
          id: "tu3",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "list", status: "completed", activeForm: "listing" },
              { content: "edit", status: "in_progress", activeForm: "editing" },
            ],
          },
        },
      ])
    );
    t.fake.emit(toolResult("tu3", "ok"));
    t.fake.emit(assistant("m4", [{ type: "tool_use", id: "tu4", name: "Grep", input: {} }]));
    t.fake.emit(toolResult("tu4", "no matches", { isError: true }));
    t.fake.emit(result([inputUuid(sent)]));
    await t.until(t.has("TurnEnded"), "TurnEnded");

    expect(t.events).toEqual([
      HarnessEvent.TurnStarted({ turnId: T1, prompt: "list files" }),
      HarnessEvent.CursorAssigned({ cursor: "claude-session-1" }),
      HarnessEvent.ItemDelta({ turnId: T1, itemId: "m1:0", field: "text", text: "Look" }),
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.AssistantMessage.make({ id: "m1:0", text: "Looking." }),
      }),
      HarnessEvent.ItemUpdated({
        turnId: T1,
        item: TurnItem.cases.CommandExecution.make({
          id: "tu1",
          command: "ls",
          cwd: "/work/repo",
          output: "",
          exitCode: null,
          status: "running",
        }),
      }),
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.CommandExecution.make({
          id: "tu1",
          command: "ls",
          cwd: "/work/repo",
          output: "a\nb",
          exitCode: null,
          status: "completed",
        }),
      }),
      HarnessEvent.ItemUpdated({
        turnId: T1,
        item: TurnItem.cases.FileChange.make({
          id: "tu2",
          changes: [{ path: "/work/repo/x.ts", kind: "modify" }],
          status: "running",
        }),
      }),
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.FileChange.make({
          id: "tu2",
          changes: [{ path: "/work/repo/x.ts", kind: "add" }],
          status: "completed",
        }),
      }),
      HarnessEvent.ItemUpdated({
        turnId: T1,
        item: TurnItem.cases.Plan.make({
          id: "plan:turn-1",
          steps: [
            { text: "list", status: "completed", detail: "listing" },
            { text: "edit", status: "in-progress", detail: "editing" },
          ],
          explanation: null,
        }),
      }),
      HarnessEvent.ItemUpdated({
        turnId: T1,
        item: TurnItem.cases.ToolCall.make({
          id: "tu4",
          name: "Grep",
          input: {},
          output: null,
          status: "running",
        }),
      }),
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.ToolCall.make({
          id: "tu4",
          name: "Grep",
          input: {},
          output: "no matches",
          status: "failed",
        }),
      }),
      // The plan is persisted once, with its last state, when the Turn ends.
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.Plan.make({
          id: "plan:turn-1",
          steps: [
            { text: "list", status: "completed", detail: "listing" },
            { text: "edit", status: "in-progress", detail: "editing" },
          ],
          explanation: null,
        }),
      }),
      HarnessEvent.TurnEnded({ turnId: T1, status: "completed", error: null }),
    ]);
    await t.close();
  });

  test("an error result fails the Turn", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "hi")));
    const sent = await t.fake.nextInput(0);
    t.fake.emit(result([inputUuid(sent)], { subtype: "error_max_turns", errors: ["too many"] }));
    await t.until(t.has("TurnEnded"));
    expect(t.events.at(-1)).toEqual(
      HarnessEvent.TurnEnded({
        turnId: T1,
        status: "failed",
        error: "too many",
      })
    );
    await t.close();
  });

  test("rejects a second Turn while one is in progress", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "one")));
    const exit = await Effect.runPromiseExit(t.session.sendTurn(turn(T2, "two")));
    expect(Exit.isFailure(exit)).toBe(true);
    await t.close();
  });

  test("a read-only session runs Bash in the sandbox with no network and no web tools", async () => {
    const t = await openFake({ readOnly: true });
    const o = t.fake.options!;

    expect(o.sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true },
    });
    expect(o.disallowedTools).toEqual(["WebFetch", "WebSearch"]);
    await t.close();

    const plain = await openFake();
    expect(plain.fake.options!.sandbox).toBeUndefined();
    await plain.close();
  });

  test("full-access keeps canUseTool, so leaving it mid-session still asks", async () => {
    const t = await openFake({ permissionMode: "full-access" });
    expect(t.fake.options!.permissionMode).toBe("bypassPermissions");
    // Registered at start even though bypassPermissions never calls it: it can't be added later.
    expect(t.fake.options!.canUseTool).toBeInstanceOf(Function);
    await t.run(t.session.setPermissionMode("supervised"));
    expect(t.fake.permissionModes).toEqual(["default"]);
    await t.run(t.session.sendTurn(turn(T1, "clean up")));
    const answer = t.fake.askPermission("Bash", { command: "rm x" }, { toolUseID: "tu1" });
    await t.until(t.has("ApprovalRequested"));
    const request = t.first("ApprovalRequested");
    await t.run(
      t.session.respond(request.requestId, ApprovalDecision.cases.Allow.make({ remember: false }))
    );
    expect(await answer).toMatchObject({ behavior: "allow" });
    await t.close();
  });

  test("an approval round-trip, remembering the rule", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "clean up")));

    const rule = {
      type: "addRules" as const,
      rules: [{ toolName: "Bash", ruleContent: "rm:*" }],
      behavior: "allow" as const,
      destination: "session" as const,
    };

    const answer = t.fake.askPermission(
      "Bash",
      { command: "rm x", description: "Remove x" },
      { toolUseID: "tu1", suggestions: [rule] }
    );

    await t.until(t.has("ApprovalRequested"));
    const request = t.first("ApprovalRequested");
    expect(request).toMatchObject({
      turnId: T1,
      kind: "command",
      title: "Remove x",
      detail: "rm x",
      options: [],
    });
    await t.run(
      t.session.respond(request.requestId, ApprovalDecision.cases.Allow.make({ remember: true }))
    );
    expect(await answer).toEqual({
      behavior: "allow",
      updatedInput: { command: "rm x", description: "Remove x" },
      updatedPermissions: [rule],
    });

    // The same request can't be answered twice.
    const again = await Effect.runPromiseExit(
      t.session.respond(request.requestId, ApprovalDecision.cases.Deny.make({ reason: null }))
    );

    expect(Exit.isFailure(again)).toBe(true);
    await t.close();
  });

  test("a denied tool call reads as declined", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "edit")));
    t.fake.emit(
      assistant("m1", [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "a" } }])
    );
    const answer = t.fake.askPermission("Edit", { file_path: "a" }, { toolUseID: "tu1" });
    await t.until(t.has("ApprovalRequested"));
    const request = t.first("ApprovalRequested");
    expect(request.kind).toBe("file-change");
    await t.run(
      t.session.respond(
        request.requestId,
        ApprovalDecision.cases.Deny.make({ reason: "not that file" })
      )
    );
    expect(await answer).toEqual({ behavior: "deny", message: "not that file" });
    t.fake.emit(toolResult("tu1", "denied", { isError: true }));
    await t.until(() => t.events.filter(HarnessEvent.$is("ItemCompleted")).length === 1);
    const completed = t.first("ItemCompleted");
    expect(t.events.at(-1)).toBe(completed);
    expect(TurnItem.guards.FileChange(completed.item)).toBe(true);
    expect(completed.item).toMatchObject({ id: "tu1", status: "declined" });
    await t.close();
  });

  test("a question is asked with its options and answered", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "pick a db")));

    const input = {
      questions: [
        {
          question: "Which database?",
          header: "DB",
          multiSelect: false,
          options: [
            { label: "SQLite", description: "embedded" },
            { label: "Postgres", description: "server" },
          ],
        },
      ],
    };

    const answer = t.fake.askPermission("AskUserQuestion", input, { toolUseID: "tu1" });
    await t.until(t.has("ApprovalRequested"));
    const request = t.first("ApprovalRequested");
    expect(request).toMatchObject({
      kind: "question",
      title: "Which database?",
      options: ["SQLite", "Postgres"],
    });
    await t.run(
      t.session.respond(request.requestId, ApprovalDecision.cases.Answer.make({ text: "SQLite" }))
    );
    expect(await answer).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which database?": "SQLite" } },
    });
    await t.close();
  });

  test("interrupt withdraws a pending approval and ends the Turn interrupted", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "long job")));
    const sent = await t.fake.nextInput(0);
    t.fake.emit(
      assistant("m1", [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "make" } }])
    );
    const answer = t.fake.askPermission("Bash", { command: "make" }, { toolUseID: "tu1" });
    await t.until(t.has("ApprovalRequested"));
    const request = t.first("ApprovalRequested");

    await t.run(t.session.interrupt);
    expect(t.fake.interrupts).toBe(1);
    expect(await answer).toMatchObject({ behavior: "deny", interrupt: true });
    await t.until(t.has("ApprovalWithdrawn"));
    expect(t.events).toContainEqual(
      HarnessEvent.ApprovalWithdrawn({ requestId: request.requestId })
    );

    t.fake.emit(result([inputUuid(sent)], { subtype: "error_during_execution" }));
    await t.until(t.has("TurnEnded"));
    expect(t.events.slice(-2)).toEqual([
      HarnessEvent.ItemCompleted({
        turnId: T1,
        item: TurnItem.cases.CommandExecution.make({
          id: "tu1",
          command: "make",
          cwd: "/work/repo",
          output: "",
          exitCode: null,
          status: "declined",
        }),
      }),
      HarnessEvent.TurnEnded({ turnId: T1, status: "interrupted", error: null }),
    ]);
    // A permission prompt after the Turn is over is refused outright.
    expect(await t.fake.askPermission("Bash", {}, { toolUseID: "tu9" })).toMatchObject({
      behavior: "deny",
    });
    await t.close();
  });

  test("steer sends mid-Turn and keeps the Turn open until it is answered", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "refactor")));
    const first = await t.fake.nextInput(0);
    await t.run(t.session.steer("also rename foo"));
    const second = await t.fake.nextInput(1);
    expect(second.message.content).toEqual([{ type: "text", text: "also rename foo" }]);
    // It shows in the Turn as soon as Claude Code has taken it.
    await t.until(t.has("ItemCompleted"));
    expect(t.events.filter(HarnessEvent.$is("ItemCompleted")).map((e) => e.item)).toEqual([
      TurnItem.cases.UserMessage.make({
        id: `steer:${inputUuid(second)}`,
        text: "also rename foo",
      }),
    ]);

    // Claude finished the first run before it could fold the steer in.
    t.fake.emit(result([inputUuid(first)]));
    t.fake.emit(assistant("m9", [{ type: "text", text: "Renamed." }]));
    await t.until(() =>
      t.events.some(
        (e) => HarnessEvent.$is("ItemCompleted")(e) && TurnItem.guards.AssistantMessage(e.item)
      )
    );
    expect(t.events.some(HarnessEvent.$is("TurnEnded"))).toBe(false);
    t.fake.emit(result([inputUuid(second)]));
    await t.until(t.has("TurnEnded"));
    expect(t.events.at(-1)).toEqual(
      HarnessEvent.TurnEnded({
        turnId: T1,
        status: "completed",
        error: null,
      })
    );
    // Steering with nothing in flight fails.
    expect(Exit.isFailure(await Effect.runPromiseExit(t.session.steer("late")))).toBe(true);
    await t.close();
  });

  test("resume passes the cursor and the terminal command resumes it", async () => {
    const t = await openFake({ resumeCursor: "claude-session-0", permissionMode: "full-access" });
    expect(t.fake.options!.resume).toBe("claude-session-0");
    expect(t.fake.options!.permissionMode).toBe("bypassPermissions");
    t.fake.emit(init("claude-session-0"));
    await Bun.sleep(10);
    // An unchanged cursor is not re-announced.
    expect(t.events.some(HarnessEvent.$is("CursorAssigned"))).toBe(false);
    expect(await t.run(t.session.terminalCommand)).toEqual([
      "claude",
      "--resume",
      "claude-session-0",
      "--permission-mode",
      "bypassPermissions",
    ]);
    await t.run(t.session.setPermissionMode("supervised"));
    expect(t.fake.permissionModes).toEqual(["default"]);
    expect(await t.run(t.session.terminalCommand)).toEqual([
      "claude",
      "--resume",
      "claude-session-0",
    ]);
    await t.close();
  });

  test("terminal command fails before Claude has a session id", async () => {
    const t = await openFake();
    expect(Exit.isFailure(await Effect.runPromiseExit(t.session.terminalCommand))).toBe(true);
    await t.close();
  });

  test("images are inlined and other attachments referenced by path", async () => {
    const t = await openFake();

    const png = new Attachment({
      id: AttachmentId.make("a1"),
      name: "shot.png",
      mimeType: "image/png",
      size: 4,
      hostPath: "/stage/shot.png",
      width: null,
      height: null,
    });

    const pdf = new Attachment({
      id: AttachmentId.make("a2"),
      name: "spec.pdf",
      mimeType: "application/pdf",
      size: 9,
      hostPath: "/stage/spec.pdf",
      width: null,
      height: null,
    });

    await t.run(t.session.sendTurn(turn(T1, "see these", [png, pdf])));
    const sent = await t.fake.nextInput(0);
    expect(sent.message.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      },
      {
        type: "text",
        text: "see these\n\nAttached files (staged on this machine; read them from these paths):\n- spec.pdf (application/pdf): /stage/spec.pdf",
      },
    ]);
    await t.close();
  });

  test("closing the scope ends the query and the event stream cleanly", async () => {
    const t = await openFake();
    await t.close();
    expect(t.fake.closed).toBe(true);
    await t.until(t.isEnded, "stream end");
    expect(t.events.at(-1)).toEqual(HarnessEvent.Exited({ error: null }));
  });

  test("claude exiting mid-Turn fails the Turn and reports the exit", async () => {
    const t = await openFake();
    await t.run(t.session.sendTurn(turn(T1, "hi")));
    t.fake.exit();
    await t.until(t.isEnded, "stream end");
    expect(t.events.slice(-2)).toEqual([
      HarnessEvent.TurnEnded({
        turnId: T1,
        status: "failed",
        error: "Claude Code exited unexpectedly",
      }),
      HarnessEvent.Exited({ error: "Claude Code exited unexpectedly" }),
    ]);
    await t.close();
  });
});

describe("probe", () => {
  test("reports the version from `claude --version` only", async () => {
    const calls: string[] = [];

    const driver = makeClaudeDriver({
      claudePath: () => "/opt/bin/claude",
      runVersion: async (path) => {
        calls.push(path);

        return { exitCode: 0, stdout: "2.1.283 (Claude Code)\n" };
      },
    });

    expect(await Effect.runPromise(driver.probe)).toEqual({
      available: true,
      version: "2.1.283",
      detail: "/opt/bin/claude",
    });
    expect(calls).toEqual(["/opt/bin/claude"]);
  });

  test("is unavailable when claude is missing or broken", async () => {
    const missing = makeClaudeDriver({ claudePath: () => null });
    expect((await Effect.runPromise(missing.probe)).available).toBe(false);

    const broken = makeClaudeDriver({
      claudePath: () => "/opt/bin/claude",
      runVersion: async () => ({ exitCode: 1, stdout: "" }),
    });

    expect((await Effect.runPromise(broken.probe)).available).toBe(false);
  });

  test("parses versions", () => {
    expect(parseVersion("2.1.283 (Claude Code)")).toBe("2.1.283");
    expect(parseVersion("nonsense")).toBeNull();
  });
});
