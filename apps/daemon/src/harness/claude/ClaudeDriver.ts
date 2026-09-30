/**
 * The Claude Code Harness driver.
 *
 * One Agent SDK `query()` per active Agent Session, in-process in the Daemon,
 * driving the user's own `claude` binary (`pathToClaudeCodeExecutable`), so the
 * binary uses its own sign-in. Polaris never reads, copies or forwards Claude
 * credentials. Turns flow into the one live query through streaming input.
 *
 * Design follows pingdotgg/t3code@de251fc (MIT) `ClaudeAdapter.ts` (streaming input,
 * `canUseTool` awaiting a deferred, `resume`, the permission-mode mapping); no code
 * was copied.
 */

import { join } from "node:path";
import {
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type ApprovalDecision,
  type PermissionMode,
  RequestId,
  type TurnId,
  TurnItem,
} from "@polaris/protocol";
import {
  type Cause,
  Deferred,
  Effect,
  Fiber,
  Inspectable,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect";
import { paths } from "../../paths.ts";
import {
  type HarnessDriver,
  HarnessError,
  HarnessEvent,
  type HarnessProbe,
  type HarnessSession,
  type OpenOptions,
  type TurnInput,
} from "../HarnessDriver.ts";
import { emptyClaudeLimitContext } from "../limits/claude.ts";
import type { PlanLimitReporter } from "../limits/PlanLimitReporter.ts";
import { ClaudeHookReceiver } from "./hooks.ts";
import { decodeModelUsage } from "./payloads.ts";
import { Inbox } from "./inbox.ts";
import { buildUserMessage } from "./input.ts";
import { isEffortLevel, listClaudeModels } from "./models.ts";
import {
  approvalKind,
  describeToolCall,
  isQuestionTool,
  parseQuestions,
  toClaudePermissionMode,
  type ToolUseInput,
  toPermissionResult,
} from "./permissions.ts";
import { type ClaudePlanLimits, claudePlanLimitReader } from "./planLimits.ts";
import { ClaudeTranslator } from "./translate.ts";

export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

export interface ClaudeDriverOptions {
  /** The SDK's `query`; injectable so tests can script a fake Claude. */
  readonly query?: QueryFn;
  /** Absolute path to `claude`; default: resolved on PATH. */
  readonly claudePath?: () => string | null;
  /** Runs `claude --version`; injectable for tests. */
  readonly runVersion?: (path: string) => Promise<{ exitCode: number; stdout: string }>;
  /** Present when the Daemon runs the hook listener for In Terminal sessions. */
  readonly hookReceiver?: ClaudeHookReceiver["Service"];
  /** Directory of staged attachments, granted read access; default `~/.polaris/staging`. */
  readonly stagingDir?: string;
  /** Read a staged attachment; injectable for tests. */
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  /** Identifier Claude Code reports for this client. */
  readonly clientApp?: string;
  /** Receives the `claude` child's stderr lines (for the Daemon log). */
  readonly onStderr?: (line: string) => void;
  /** Receives the account's Plan Limits as Claude Code reports them. */
  readonly planLimits?: PlanLimitReporter["Service"];
}

const HARNESS = "claude";

const harnessError = (message: string, cause?: unknown) =>
  new HarnessError(
    cause === undefined ? { harness: HARNESS, message } : { harness: HARNESS, message, cause }
  );

const unknownEffort = (effort: string) =>
  harnessError(`Claude Code has no "${effort}" effort level`);

const defaultRunVersion = async (path: string) => {
  const proc = Bun.spawn([path, "--version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 10_000,
  });

  const stdout = await new Response(proc.stdout).text();

  return { exitCode: await proc.exited, stdout };
};

/** `2.1.283 (Claude Code)` → `2.1.283`. */
export const parseVersion = (stdout: string): string | null =>
  /(\d+\.\d+\.\d+[^\s]*)/.exec(stdout)?.[1] ?? null;

/** How a Turn ends when every message sent for it is answered. */
interface TurnOutcome {
  readonly status: "completed" | "failed";
  readonly error: string | null;
}

/** The largest context window among the Models a result used: the Turn's own Model. */
const contextWindowOf = (result: SDKResultMessage): number | null => {
  const usage = decodeModelUsage(result.modelUsage);

  const windows = Option.isSome(usage)
    ? Object.values(usage.value).map((model) => model.contextWindow)
    : [];

  return windows.length === 0 ? null : Math.max(...windows);
};

const resultOutcome = (result: SDKResultMessage): TurnOutcome => {
  if (result.subtype === "success")
    return result.is_error
      ? { status: "failed", error: result.result || "Claude reported an error" }
      : { status: "completed", error: null };

  return {
    status: "failed",
    error: result.errors.length > 0 ? result.errors.join("\n") : result.subtype,
  };
};

interface PendingApproval {
  readonly toolName: string;
  readonly toolUseId: string;
  readonly input: ToolUseInput;
  readonly suggestions: ReadonlyArray<PermissionUpdate>;
  readonly deferred: Deferred.Deferred<PermissionResult>;
}

interface ActiveTurn {
  readonly turnId: TurnId;
  /** Uuids of user messages sent for this Turn that Claude has not yet answered. */
  readonly pending: Set<string>;
  interrupting: boolean;
  outcome: TurnOutcome;
}

const openSession = Effect.fnUntraced(function* (
  driver: Required<Pick<ClaudeDriverOptions, "query" | "claudePath">> &
    ClaudeDriverOptions & { readonly limits: ClaudePlanLimits | null },
  options: OpenOptions
) {
  const claudePath = driver.claudePath();

  if (claudePath === null)
    return yield* harnessError("Claude Code is not installed: `claude` was not found on PATH");

  const scope = yield* Scope.Scope;
  const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>();
  const emit = (event: HarnessEvent) => Queue.offerUnsafe(events, event);

  const emitAll = (list: ReadonlyArray<HarnessEvent>) => {
    for (const e of list) emit(e);
  };

  const translator = new ClaudeTranslator(options.cwd, options.resumeCursor);
  const inbox = new Inbox<SDKUserMessage>();
  const approvals = new Map<RequestId, PendingApproval>();
  /** Steer messages an interrupt cancelled; if Claude starts on one anyway, interrupt again. */
  const cancelled = new Set<string>();
  let active: ActiveTurn | null = null;
  let permissionMode: PermissionMode = options.permissionMode;
  let closing = false;
  let exited = false;

  const settle = (requestId: RequestId, result: PermissionResult) => {
    const pending = approvals.get(requestId);

    if (!pending) return;
    approvals.delete(requestId);

    if (result.behavior === "deny") translator.markDeclined(pending.toolUseId);
    Deferred.doneUnsafe(pending.deferred, Effect.succeed(result));
  };

  /** Withdraw every open approval (interrupt, close, exit) and answer Claude with a deny. */
  const withdrawAll = (message: string) => {
    for (const requestId of approvals.keys()) {
      emit(HarnessEvent.ApprovalWithdrawn({ requestId }));
      settle(requestId, { behavior: "deny", message, interrupt: true });
    }
  };

  const endTurn = (status: "completed" | "interrupted" | "failed", error: string | null) => {
    const turn = active;

    if (!turn) return;
    active = null;
    emitAll(translator.closeOpenTools(turn.turnId, status === "completed" ? "failed" : "declined"));
    translator.endTurn();
    emit(HarnessEvent.TurnEnded({ turnId: turn.turnId, status, error }));
    limits?.refresh();
    readContext();
  };

  const canUseTool: CanUseTool = async (toolName, input, context) => {
    const turn = active;

    if (!turn || turn.interrupting || closing)
      return { behavior: "deny", message: "No Turn is in progress.", interrupt: true };
    const requestId = RequestId.make(crypto.randomUUID());
    const deferred = Deferred.makeUnsafe<PermissionResult>();
    approvals.set(requestId, {
      toolName,
      toolUseId: context.toolUseID,
      input,
      suggestions: context.suggestions ?? [],
      deferred,
    });
    const described = describeToolCall(toolName, input);
    const questions = isQuestionTool(toolName) ? parseQuestions(input) : [];
    emit(
      HarnessEvent.ApprovalRequested({
        turnId: turn.turnId,
        requestId,
        kind: approvalKind(toolName),
        title: isQuestionTool(toolName) ? described.title : (context.title ?? described.title),
        detail: described.detail ?? context.description ?? null,
        options: questions.length === 1 ? questions[0]!.options : [],
      })
    );

    const onAbort = () => {
      if (!approvals.has(requestId)) return;
      emit(HarnessEvent.ApprovalWithdrawn({ requestId }));
      settle(requestId, { behavior: "deny", message: "The request was cancelled." });
    };

    context.signal.addEventListener("abort", onAbort, { once: true });

    try {
      return await Effect.runPromise(Deferred.await(deferred));
    } finally {
      context.signal.removeEventListener("abort", onAbort);
    }
  };

  const sdkOptions: Options = {
    cwd: options.cwd,
    pathToClaudeCodeExecutable: claudePath,
    permissionMode: toClaudePermissionMode(options.permissionMode),
    // Only makes `bypassPermissions` selectable later (full-access); it does not enable it.
    allowDangerouslySkipPermissions: true,
    // Registered even in full-access, so prompts still work after a later mode change; the
    // SDK's CLAUDE_SDK_CAN_USE_TOOL_SHADOWED warning is expected. See this driver's README.
    canUseTool,
    includePartialMessages: true,
    // Subagents' own text and thinking, not only their tool calls (see translate.ts).
    forwardSubagentText: true,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    additionalDirectories: [join(driver.stagingDir ?? paths().staging, options.sessionId)],
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: driver.clientApp ?? "polaris-daemon",
    },
  };

  if (options.model !== null) sdkOptions.model = options.model;

  if (options.effort !== null) {
    if (!isEffortLevel(options.effort)) return yield* unknownEffort(options.effort);
    sdkOptions.effort = options.effort;
  }

  if (options.resumeCursor !== null) sdkOptions.resume = options.resumeCursor;

  if (driver.onStderr) sdkOptions.stderr = driver.onStderr;

  const q = yield* Effect.try({
    try: () => driver.query({ prompt: inbox, options: sdkOptions }),
    catch: (cause) => harnessError("Could not start Claude Code", cause),
  });

  const limits = driver.limits ? claudePlanLimitReader(driver.limits, q) : null;
  limits?.read();

  /** Claude Code's own count of the context (as `/context` shows it), where the SDK offers it. */
  const readContext = () => {
    // A Claude Code without it rejects, and the header shows no Context.
    void Promise.resolve()
      .then(() => q.getContextUsage({ detail: "summary" }))
      .then(
        (usage) => {
          if (!exited) emitAll(translator.onContextUsage(usage.totalTokens, usage.maxTokens));
        },
        () => {}
      );
  };

  if (options.resumeCursor !== null) readContext();

  const finish = (error: string | null) => {
    if (exited) return;
    exited = true;
    withdrawAll("Claude Code stopped.");
    endTurn(error === null && closing ? "interrupted" : "failed", error ?? "Claude Code exited");
    emit(HarnessEvent.Exited({ error }));
    Queue.endUnsafe(events);
  };

  const onResult = (result: SDKResultMessage) => {
    const turn = active;

    if (!turn) return;

    const uuids =
      result.user_message_uuids ?? (result.user_message_uuid ? [result.user_message_uuid] : null);

    // Older CLIs don't echo uuids: then a result answers everything sent so far.
    if (uuids === null) turn.pending.clear();
    else for (const u of uuids) turn.pending.delete(u);
    turn.outcome = resultOutcome(result);
    emitAll(translator.onContextUsage(null, contextWindowOf(result)));

    if (turn.interrupting) {
      for (const u of turn.pending) cancelled.add(u);
      endTurn("interrupted", null);
    } else if (turn.pending.size === 0) {
      endTurn(turn.outcome.status, turn.outcome.error);
    }
  };

  const onMessage = (message: SDKMessage) => {
    if (message.type === "result") return onResult(message);
    limits?.onMessage(message);
    const echo = "user_message_uuid" in message ? message.user_message_uuid : undefined;

    if (echo !== undefined && cancelled.delete(echo)) {
      // A steer an interrupt could not recall started its own run: stop it too.
      void q.interrupt().catch(() => {});
    }

    emitAll(translator.onMessage(message));
  };

  // Finalizers run in reverse: close the query, stop the reader, then report the exit.
  yield* Effect.addFinalizer(() => Effect.sync(() => finish(null)));

  const reader = yield* Stream.fromAsyncIterable(q, (cause) => cause).pipe(
    Stream.runForEach((message) => Effect.sync(() => onMessage(message))),
    Effect.matchCause({
      onSuccess: () => finish(closing ? null : "Claude Code exited unexpectedly"),
      onFailure: (cause) => finish(closing ? null : (causeMessage(cause) ?? "Claude Code failed")),
    }),
    Effect.forkIn(scope)
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closing = true;
      withdrawAll("The session was closed.");
      inbox.end();
      q.close();
      yield* Fiber.interrupt(reader);
    })
  );

  const send = Effect.fnUntraced(function* (prompt: string, input: TurnInput | null) {
    const uuid = crypto.randomUUID();

    const message = yield* buildUserMessage({
      uuid,
      prompt,
      attachments: input?.attachments ?? [],
      readFile: driver.readFile,
    });

    return { uuid, message };
  });

  /** The Model and effort the live query runs with; a Turn that asks for others switches first. */
  const running = { model: options.model, effort: options.effort };

  /**
   * A control request an older Claude Code may not know: on failure the Turn still runs, on
   * what the query already had. See the availability README for the versions checked.
   */
  const tryControl = (what: string, request: () => Promise<void>) =>
    Effect.tryPromise(request).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.logWarning(`Claude Code: ${what} failed; the Turn runs without it`, cause).pipe(
          Effect.as(false)
        )
      )
    );

  const switchTo = Effect.fnUntraced(function* (model: string | null, effort: string | null) {
    if (model !== running.model) {
      const switched = yield* tryControl(`switching to ${model ?? "the default Model"}`, () =>
        q.setModel(model ?? undefined)
      );

      if (switched) running.model = model;
    }

    if (effort === running.effort) return;

    if (effort !== null && !isEffortLevel(effort)) return yield* unknownEffort(effort);

    // A null effortLevel goes back to the Model's default effort.
    const set = yield* tryControl(`setting the effort to ${effort ?? "default"}`, () =>
      q.applyFlagSettings({ effortLevel: effort })
    );

    if (set) running.effort = effort;
  });

  const sendTurn = Effect.fn("ClaudeSession.sendTurn")(function* (input: TurnInput) {
    if (exited || closing) return yield* harnessError("The Claude session has ended");

    if (active) return yield* harnessError("A Turn is already in progress; steer it instead");
    yield* switchTo(input.model, input.effort);
    const { uuid, message } = yield* send(input.prompt, input);
    active = {
      turnId: input.turnId,
      pending: new Set([uuid]),
      interrupting: false,
      outcome: { status: "completed", error: null },
    };
    translator.beginTurn(input.turnId);
    emit(HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }));
    inbox.push(message);
  });

  /**
   * Claude Code folds a user message sent mid-Turn into the running Turn between tool
   * rounds; if the Turn ends first, it runs next. Either way the Polaris Turn stays open
   * until every message sent for it has been answered.
   */
  const steer = Effect.fn("ClaudeSession.steer")(function* (text: string) {
    const turn = active;

    if (!turn || turn.interrupting) return yield* harnessError("No Turn is in progress to steer");
    const { uuid, message } = yield* send(text, null);
    turn.pending.add(uuid);
    inbox.push(message);
    // Claude Code has taken it into the Turn's input: record it where it landed.
    emit(
      HarnessEvent.ItemCompleted({
        turnId: turn.turnId,
        item: TurnItem.cases.UserMessage.make({ id: `steer:${uuid}`, text }),
      })
    );
  });

  const interrupt = Effect.gen(function* () {
    const turn = active;

    if (!turn || turn.interrupting) return;
    turn.interrupting = true;
    withdrawAll("The user interrupted the Turn.");
    yield* Effect.tryPromise({
      try: () => q.interrupt(),
      catch: (cause) => harnessError("Could not interrupt Claude", cause),
    });
  }).pipe(Effect.withSpan("ClaudeSession.interrupt"));

  const respond = Effect.fn("ClaudeSession.respond")(function* (
    requestId: RequestId,
    decision: ApprovalDecision
  ) {
    const pending = approvals.get(requestId);

    if (!pending) return yield* harnessError(`No open request ${requestId}`);
    settle(requestId, toPermissionResult(decision, pending));
  });

  const setPermissionMode = Effect.fn("ClaudeSession.setPermissionMode")(function* (
    mode: PermissionMode
  ) {
    yield* Effect.tryPromise({
      try: () => q.setPermissionMode(toClaudePermissionMode(mode)),
      catch: (cause) => harnessError("Could not change the permission mode", cause),
    });
    permissionMode = mode;
  });

  const terminalCommand = Effect.gen(function* () {
    const cursor = translator.sessionCursor ?? options.resumeCursor;

    if (cursor === null)
      return yield* harnessError("Claude has not started this session yet; send a Turn first");
    const argv: Array<string> = ["claude", "--resume", cursor];
    const mode = toClaudePermissionMode(permissionMode);

    if (mode !== "default") argv.push("--permission-mode", mode);

    if (driver.hookReceiver) {
      const { settingsPath } = yield* driver.hookReceiver.prepare({
        sessionId: options.sessionId,
        cursor,
      });

      argv.push("--settings", settingsPath);
    }

    return argv;
  });

  const session: HarnessSession = {
    events: Stream.fromQueue(events),
    sendTurn,
    steer,
    interrupt,
    respond,
    setPermissionMode,
    terminalCommand,
  };

  return session;
});

const causeMessage = (cause: Cause.Cause<unknown>): string | null => {
  for (const reason of cause.reasons) {
    const value = "error" in reason ? reason.error : "defect" in reason ? reason.defect : null;

    if (value instanceof Error) return value.message;

    if (value !== null && value !== undefined) return Inspectable.toStringUnknown(value);
  }

  return null;
};

export const makeClaudeDriver = (options: ClaudeDriverOptions = {}): HarnessDriver => {
  const driver = {
    ...options,
    query: options.query ?? sdkQuery,
    claudePath: options.claudePath ?? (() => Bun.which("claude")),
    limits: options.planLimits
      ? { sink: options.planLimits, context: emptyClaudeLimitContext() }
      : null,
  };

  const runVersion = options.runVersion ?? defaultRunVersion;

  const probe: Effect.Effect<HarnessProbe> = Effect.gen(function* () {
    const path = driver.claudePath();

    if (path === null)
      return { available: false, version: null, detail: "`claude` was not found on PATH" };
    const result = yield* Effect.tryPromise(() => runVersion(path)).pipe(Effect.option);

    if (Option.isNone(result) || result.value.exitCode !== 0)
      return { available: false, version: null, detail: `\`${path} --version\` failed` };

    return { available: true, version: parseVersion(result.value.stdout), detail: path };
  }).pipe(Effect.withSpan("ClaudeDriver.probe"));

  const hooks = options.hookReceiver;

  const claude: HarnessDriver = {
    kind: "claude",
    capabilities: { steer: true, liveCoAttach: false, switchModel: true },
    probe,
    listModels: listClaudeModels(driver),
    open: (open) => openSession(driver, open),
  };

  // While In Terminal, Polaris follows the TUI through its HTTP hooks (hooks.ts).
  return hooks
    ? { ...claude, terminalFollow: { events: hooks.events, release: hooks.release } }
    : claude;
};

/** The Claude driver with the Daemon's hook listener, for the `HarnessRegistry`. */
export const ClaudeDriver = Effect.gen(function* () {
  const hookReceiver = yield* ClaudeHookReceiver;

  return makeClaudeDriver({ hookReceiver });
});
