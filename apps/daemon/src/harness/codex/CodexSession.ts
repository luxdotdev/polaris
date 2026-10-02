/**
 * One Agent Session's view of one Codex thread on the shared app-server.
 *
 * Each session opens its own connection, starts or rejoins its thread
 * (`thread/start` / `thread/resume`), and translates that thread's
 * notifications and server→client requests into `HarnessEvent`s. Because the
 * thread lives in the shared app-server, a `codex --remote` TUI can attach to
 * it at the same time; Turns the TUI starts show up here too.
 */
import {
  ApprovalDecision,
  type ApprovalKind,
  type PermissionMode,
  RequestId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import {
  type Cause,
  Data,
  Deferred,
  Effect,
  Option,
  Queue,
  Schema,
  type Scope,
  Stream,
} from "effect";
import {
  type HarnessError,
  HarnessEvent,
  type HarnessSession,
  type OpenOptions,
  type TurnInput,
} from "../HarnessDriver.ts";
import type { AppServer } from "./AppServer.ts";
import {
  type CodexPlanLimits,
  onRateLimitsUpdated,
  RATE_LIMITS_UPDATED,
  readRateLimits,
} from "./planLimits.ts";
import {
  approvalDecision,
  elicitationDecision,
  permissionsDecision,
  policyFor,
  readableError,
  sandboxPolicyFor,
  toPlanItem,
  toTurnItem,
  turnInput,
  userInputDecision,
  userMessageText,
} from "./mapping.ts";
import * as P from "./protocol.ts";
import { codexError, Incoming, type RpcConnection } from "./RpcConnection.ts";
import { ReasoningTimes } from "./reasoning.ts";
import { CodexSteers } from "./steers.ts";
import { CodexSubagents } from "./subagents.ts";
import { requestCompat } from "./compat.ts";
import { type HarnessCall, harnessCallOf } from "./slash.ts";

export interface SessionConfig {
  readonly appServer: AppServer;
  readonly codexPath: string;
  readonly clientVersion: string;
  /** Where the account's Plan Limits go; null, they aren't read. */
  readonly planLimits: CodexPlanLimits | null;
}

type PendingRequest = Data.TaggedEnum<{
  Rpc: {
    readonly rpcId: P.RpcId;
    readonly respond: (decision: ApprovalDecision) => P.ServerRequestResponse;
  };
  /** An async question in an agent message; answered with a new user message. */
  AsyncQuestion: { readonly title: string };
}>;

const PendingRequest = Data.taggedEnum<PendingRequest>();

const isRpc = PendingRequest.$is("Rpc");

/** Hoisted: the taggedEnum accessor builds a new constructor on every property read. */
const { ItemDelta } = HarnessEvent;

/** A server request Polaris shows as an approval, and how to answer it. */
interface ApprovalPrompt {
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly detail: string | null;
  readonly options: ReadonlyArray<string>;
  readonly respond: (decision: ApprovalDecision) => P.ServerRequestResponse;
}

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => {
  const decodeOption = Schema.decodeUnknownOption(schema);

  return (input: P.RpcPayload): S["Type"] | null => Option.getOrNull(decodeOption(input));
};

const decodeThread = decode(P.ThreadResponse);

const decodeTurnStart = decode(P.TurnStartResponse);

const decodeReviewStart = decode(P.ReviewStartResponse);

const decodeTurnStarted = decode(P.TurnStartedNotification);

const decodeTurnCompleted = decode(P.TurnCompletedNotification);

const decodeItem = decode(P.ItemNotification);

const decodeDelta = decode(P.DeltaNotification);

const decodePlan = decode(P.TurnPlanUpdatedNotification);

const decodeTokenUsage = decode(P.ThreadTokenUsageUpdatedNotification);

const decodeResolved = decode(P.ServerRequestResolvedNotification);

const decodeError = decode(P.ErrorNotification);

const decodeName = decode(P.ThreadNameUpdatedNotification);

const decodeCommandApproval = decode(P.CommandApprovalParams);

const decodeFileApproval = decode(P.FileChangeApprovalParams);

const decodePermissions = decode(P.PermissionsApprovalParams);

const decodeUserInput = decode(P.UserInputParams);

const decodeElicitation = decode(P.ElicitationParams);

const newTurnId = () => TurnId.make(crypto.randomUUID());

const newRequestId = () => RequestId.make(crypto.randomUUID());

/** Items whose text streams as deltas; the others show live progress while running. */
const isStreamedText = TurnItem.isAnyOf(["AssistantMessage", "Reasoning"]);

type ItemNotification = typeof P.ItemNotification.Type;

type AgentMessage = typeof P.AgentMessageItem.Type;

/** The questions of an async agent message, which the user may answer later. */
const asyncQuestions = (item: P.ThreadItem): AgentMessage["questions"] =>
  item.type === "agentMessage" && "delivery" in item && item.delivery === "async"
    ? item.questions
    : null;

/** The approval shown for each server request Polaris answers; null when its params don't parse. */
const approvalPrompts = new Map<
  string,
  (params: P.RpcPayload) => {
    readonly threadId: string;
    readonly turnId: string | null;
    readonly prompt: ApprovalPrompt;
  } | null
>([
  [
    "item/commandExecution/requestApproval",
    (params) => {
      const p = decodeCommandApproval(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "command",
              title: p.command ?? "Run a command",
              detail: p.reason ?? p.cwd ?? null,
              options: [],
              respond: approvalDecision,
            },
          };
    },
  ],
  [
    "item/fileChange/requestApproval",
    (params) => {
      const p = decodeFileApproval(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "file-change",
              title: p.grantRoot ? `Allow writes under ${p.grantRoot}` : "Apply file changes",
              detail: p.reason ?? null,
              options: [],
              respond: approvalDecision,
            },
          };
    },
  ],
  [
    "item/permissions/requestApproval",
    (params) => {
      const p = decodePermissions(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "tool",
              title: "Grant additional permissions",
              detail: [p.reason, JSON.stringify(p.permissions)].filter(Boolean).join("\n"),
              options: [],
              respond: (decision) => permissionsDecision(p.permissions, decision),
            },
          };
    },
  ],
  [
    "item/tool/requestUserInput",
    (params) => {
      const p = decodeUserInput(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "question",
              title: p.questions.map((q) => q.question).join("\n"),
              detail: p.questions.map((q) => q.header).join(" · ") || null,
              options: p.questions[0]?.options?.map((o) => o.label) ?? [],
              respond: (decision) => userInputDecision(p.questions, decision),
            },
          };
    },
  ],
  [
    "mcpServer/elicitation/request",
    (params) => {
      const p = decodeElicitation(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "tool",
              title: `${p.serverName}: ${p.message}`,
              detail: null,
              options: [],
              respond: elicitationDecision,
            },
          };
    },
  ],
]);

export const openSession = (
  config: SessionConfig,
  options: OpenOptions
): Effect.Effect<HarnessSession, HarnessError, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>();

    const emit = (event: HarnessEvent) => {
      Queue.offerUnsafe(events, event);
    };

    const conn: RpcConnection = yield* config.appServer.connect;
    yield* conn.request("initialize", {
      clientInfo: { name: "polaris", title: "Polaris", version: config.clientVersion },
      capabilities: { experimentalApi: false, requestAttestation: false },
    } satisfies P.ClientParams["initialize"]);
    yield* conn.notify("initialized");

    if (config.planLimits) yield* Effect.forkScoped(readRateLimits(conn, config.planLimits));

    let permissionMode: PermissionMode = options.permissionMode;
    const policy = policyFor(permissionMode, options.readOnly);

    const common: Pick<
      P.ClientParams["thread/start"],
      | "cwd"
      | "approvalPolicy"
      | "approvalsReviewer"
      | "sandbox"
      | "model"
      | "developerInstructions"
      | "config"
    > = {
      cwd: options.cwd,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandbox: policy.sandbox,
    };

    const attachments =
      options.constellations ??
      (options.constellation === undefined ? [] : [options.constellation]);

    if (attachments.length > 0 && options.readOnly !== true) {
      if (attachments.some((a) => a.sessionId !== options.sessionId))
        return yield* codexError("Constellation attachment belongs to another session");
      common.developerInstructions = attachments.map((a) => a.instructions).join("\n\n");
      common.config = Object.fromEntries(
        attachments.map((a, index) => [
          `mcp_servers.polaris${index === 0 ? "" : `_${index}`}`,
          { url: a.url },
        ])
      );
    }

    if (
      options.environment !== undefined &&
      Object.keys(options.environment).length > 0 &&
      options.readOnly !== true
    )
      common.config = { ...common.config, "shell_environment_policy.set": options.environment };

    if (options.model !== null) common.model = options.model;

    // Without the fields an older app-server may refuse (compat.ts): approvals go to the user.
    const { approvalsReviewer: _reviewer, ...olderCommon } = common;

    const threadResult =
      options.resumeCursor === null
        ? yield* requestCompat(
            conn,
            "thread/start",
            { ...common, serviceName: "polaris" } satisfies P.ClientParams["thread/start"],
            olderCommon satisfies P.ClientParams["thread/start"]
          )
        : yield* requestCompat(
            conn,
            "thread/resume",
            {
              ...common,
              threadId: options.resumeCursor,
              excludeTurns: true,
            } satisfies P.ClientParams["thread/resume"],
            {
              ...olderCommon,
              threadId: options.resumeCursor,
            } satisfies P.ClientParams["thread/resume"]
          );

    const thread = decodeThread(threadResult);

    if (thread === null) return yield* codexError("Unexpected thread/start response from Codex");
    const threadId = thread.thread.id;
    emit(HarnessEvent.CursorAssigned({ cursor: threadId }));

    // --- Turn bookkeeping -------------------------------------------------
    const turns = new Map<string, TurnId>(); // Codex turn id → Polaris TurnId
    /** Codex turns whose `TurnStarted` was emitted. */
    const announced = new Set<string>();
    const plans = new Map<string, typeof P.TurnPlanUpdatedNotification.Type>();
    const reasoning = new ReasoningTimes();
    let activeCodexTurn: string | null = null;
    /** A Turn Polaris is starting (`turn/start` in flight), with the prompt it sent. */
    let pendingLocalTurn: { readonly turnId: TurnId; readonly prompt: string } | null = null;
    const endedTurns = new Set<string>();
    /** A review's Codex turn: Codex runs it under a second turn id, whose events join it. */
    let reviewTurn: string | null = null;
    let errorCount = 0;
    const subagents = new CodexSubagents();
    const steers = new CodexSteers();

    const announce = (codexTurnId: string, prompt: string | null) => {
      const turnId = turns.get(codexTurnId);

      if (turnId === undefined || announced.has(codexTurnId)) return;
      announced.add(codexTurnId);

      for (const [other, bound] of turns)
        if (bound === turnId && other !== codexTurnId && announced.has(other)) return;
      emit(HarnessEvent.TurnStarted({ turnId, prompt }));
    };

    /**
     * Maps a Codex turn to a Polaris Turn. Turns Polaris started are announced with
     * their prompt at once. A Turn started elsewhere (the TUI) is announced when its
     * user message arrives, so it carries what was typed; with `announce` (anything
     * else happening in the Turn, e.g. when rejoining mid-Turn) it is announced
     * without one.
     */
    const turnFor = (codexTurnId: string, options?: { readonly announce: boolean }): TurnId => {
      let turnId = turns.get(codexTurnId);

      if (turnId === undefined) {
        const local = pendingLocalTurn;
        pendingLocalTurn = null;
        turnId = local?.turnId ?? newTurnId();
        turns.set(codexTurnId, turnId);

        if (!endedTurns.has(codexTurnId)) activeCodexTurn = codexTurnId;

        if (local !== null) announce(codexTurnId, local.prompt);
      }

      if (options?.announce !== false) announce(codexTurnId, null);

      return turnId;
    };

    /** Live progress for items with a visible running state; text streams as deltas instead. */
    const progressOf = (item: P.ThreadItem) => {
      const mapped = toTurnItem(item);

      return mapped === null || isStreamedText(mapped) ? null : mapped;
    };

    // --- Approvals --------------------------------------------------------
    const pending = new Map<RequestId, PendingRequest>();
    const byRpcId = new Map<string, RequestId>();

    /**
     * The Polaris Turn a server request belongs to. A Subagent's request names its
     * own thread's turn, never a Turn of ours: it goes to the Turn that spawned the
     * Subagent, or the one in flight when the parent hasn't reported it yet.
     */
    const requestTurn = (requestThread: string, codexTurnId: string | null): TurnId => {
      if (requestThread === threadId) return turnFor(codexTurnId ?? activeCodexTurn ?? "");
      const scope = subagents.scopeOf(requestThread);

      if (scope !== undefined) return scope.turnId;
      const known = codexTurnId === null ? undefined : turns.get(codexTurnId);

      return known ?? turnFor(activeCodexTurn ?? codexTurnId ?? "");
    };

    const openRequest = (rpcId: P.RpcId, turnId: TurnId, prompt: ApprovalPrompt) => {
      const requestId = newRequestId();
      pending.set(requestId, PendingRequest.Rpc({ rpcId, respond: prompt.respond }));
      byRpcId.set(String(rpcId), requestId);
      emit(
        HarnessEvent.ApprovalRequested({
          turnId,
          requestId,
          kind: prompt.kind,
          title: prompt.title,
          detail: prompt.detail,
          options: prompt.options,
        })
      );
    };

    const handleRequest = (id: P.RpcId, method: string, params: P.RpcPayload) => {
      const toPrompt = approvalPrompts.get(method);

      // Dynamic tools, attestation and ChatGPT token refresh are never enabled by Polaris,
      // and Polaris never handles credentials.
      if (toPrompt === undefined)
        return conn.respondError(id, -32601, `Polaris does not handle ${method}`);
      const request = toPrompt(params);

      if (request === null)
        return conn.respondError(id, -32602, `Polaris could not read ${method}`);

      if (options.readOnly === true)
        return conn.respond(
          id,
          request.prompt.respond(
            ApprovalDecision.cases.Deny.make({ reason: "The Reviewer never requests permission." })
          )
        );
      openRequest(id, requestTurn(request.threadId, request.turnId), request.prompt);

      return Effect.void;
    };

    // --- Notifications ----------------------------------------------------
    const ours = <T extends { readonly threadId: string }>(p: T | null): p is T =>
      p !== null && p.threadId === threadId;

    const onUserMessage = (p: ItemNotification) => {
      const turnId = turnFor(p.turnId, { announce: false });
      const text = userMessageText(p.item);
      announce(p.turnId, text);
      const steer = steers.fromItem(p.turnId, p.item.id ?? `text:${text}`, text);

      if (steer !== null) emit(HarnessEvent.ItemCompleted({ turnId, item: steer }));
    };

    const openAsyncQuestions = (turnId: TurnId, item: P.ThreadItem) => {
      for (const question of asyncQuestions(item) ?? []) {
        const requestId = newRequestId();
        pending.set(requestId, PendingRequest.AsyncQuestion({ title: question.title }));
        emit(
          HarnessEvent.ApprovalRequested({
            turnId,
            requestId,
            kind: "question",
            title: question.title,
            detail: null,
            options: question.options ?? [],
          })
        );
      }
    };

    /** An item on a Subagent's thread: the Subagent's own (what it was asked is skipped). */
    const onSubagentItem = (p: ItemNotification, completed: boolean) => {
      const scope = subagents.scopeOf(p.threadId);
      const item = scope && (completed ? toTurnItem(p.item) : progressOf(p.item));

      if (!scope || !item) return;
      emit((completed ? HarnessEvent.ItemCompleted : HarnessEvent.ItemUpdated)({ ...scope, item }));
    };

    const onItemStarted = (params: P.RpcPayload) => {
      const p = decodeItem(params);

      if (p === null) return;

      if (p.threadId !== threadId) return onSubagentItem(p, false);

      if (p.item.type === "userMessage") return onUserMessage(p);
      const turnId = turnFor(p.turnId);

      const item =
        p.item.type === "reasoning" && p.item.id !== undefined
          ? reasoning.start(p.item.id, p.startedAtMs)
          : progressOf(p.item);

      if (item !== null) emit(HarnessEvent.ItemUpdated({ turnId, item }));

      for (const event of subagents.fromParentItem(turnId, p.item)) emit(event);
    };

    const onItemCompleted = (params: P.RpcPayload) => {
      const p = decodeItem(params);

      if (p === null) return;

      if (p.threadId !== threadId) return onSubagentItem(p, true);

      if (p.item.type === "userMessage") return onUserMessage(p);
      const turnId = turnFor(p.turnId);
      const item = toTurnItem(p.item);

      if (item !== null)
        emit(HarnessEvent.ItemCompleted({ turnId, item: reasoning.finish(item, p.completedAtMs) }));

      for (const event of subagents.fromParentItem(turnId, p.item)) emit(event);
      openAsyncQuestions(turnId, p.item);
    };

    const onDelta = (field: "text" | "output") => (params: P.RpcPayload) => {
      const p = decodeDelta(params);

      if (p === null) return;

      const scope =
        p.threadId === threadId ? { turnId: turnFor(p.turnId) } : subagents.scopeOf(p.threadId);

      if (scope) emit(ItemDelta({ ...scope, itemId: p.itemId, field, text: p.delta }));
    };

    const onTurnCompleted = (params: P.RpcPayload) => {
      const p = decodeTurnCompleted(params);

      if (!ours(p)) return;
      const turnId = turnFor(p.turn.id);
      const plan = plans.get(p.turn.id);

      if (plan !== undefined) {
        emit(HarnessEvent.ItemCompleted({ turnId, item: toPlanItem(`${p.turn.id}:plan`, plan) }));
        plans.delete(p.turn.id);
      }

      endedTurns.add(p.turn.id);
      steers.end(p.turn.id);

      if (activeCodexTurn === p.turn.id) activeCodexTurn = null;

      if (reviewTurn === p.turn.id) reviewTurn = null;
      emit(
        HarnessEvent.TurnEnded({
          turnId,
          status: p.turn.status === "inProgress" ? "completed" : p.turn.status,
          error: p.turn.error ? readableError(p.turn.error.message) : null,
        })
      );
    };

    const notificationHandlers = new Map<string, (params: P.RpcPayload) => void>([
      [
        "thread/name/updated",
        (params) => {
          const p = decodeName(params);

          if (ours(p) && p.threadName) emit(HarnessEvent.TitleSuggested({ title: p.threadName }));
        },
      ],
      [
        "turn/started",
        (params) => {
          const p = decodeTurnStarted(params);

          if (p === null) return;

          if (p.threadId !== threadId) {
            // A Subagent's own turn belongs to the Polaris Turn that spawned it (its approvals too).
            const scope = subagents.scopeOf(p.threadId);

            if (scope) {
              turns.set(p.turn.id, scope.turnId);
              announced.add(p.turn.id);
            }

            return;
          }

          if (reviewTurn !== null && p.turn.id !== reviewTurn) {
            turns.set(p.turn.id, turnFor(reviewTurn, { announce: false }));
            announced.add(p.turn.id);
            activeCodexTurn = reviewTurn;

            return;
          }

          activeCodexTurn = p.turn.id;
          // A Turn started elsewhere is announced with its user message, which comes next.
          turnFor(p.turn.id, { announce: false });
        },
      ],
      ["item/started", onItemStarted],
      ["item/agentMessage/delta", onDelta("text")],
      ["item/plan/delta", onDelta("text")],
      ["item/reasoning/summaryTextDelta", onDelta("text")],
      ["item/reasoning/textDelta", onDelta("text")],
      ["item/commandExecution/outputDelta", onDelta("output")],
      ["item/completed", onItemCompleted],
      [
        "turn/plan/updated",
        (params) => {
          const p = decodePlan(params);

          if (!ours(p)) return;
          plans.set(p.turnId, p);
          emit(
            HarnessEvent.ItemUpdated({
              turnId: turnFor(p.turnId),
              item: toPlanItem(`${p.turnId}:plan`, p),
            })
          );
        },
      ],
      [
        "error",
        (params) => {
          const p = decodeError(params);

          if (!ours(p) || p.willRetry) return;
          emit(
            HarnessEvent.ItemCompleted({
              turnId: turnFor(p.turnId),
              item: TurnItem.cases.Error.make({
                id: `${p.turnId}:error:${++errorCount}`,
                message: readableError(p.error.message),
              }),
            })
          );
        },
      ],
      [
        "serverRequest/resolved",
        (params) => {
          const p = decodeResolved(params);

          if (p === null) return;
          const requestId = byRpcId.get(String(p.requestId));

          if (requestId === undefined) return;
          byRpcId.delete(String(p.requestId));

          // Still pending means someone else (the TUI, or Codex itself) resolved it.
          if (pending.delete(requestId)) emit(HarnessEvent.ApprovalWithdrawn({ requestId }));
        },
      ],
      ["turn/completed", onTurnCompleted],
      [
        "thread/tokenUsage/updated",
        (params) => {
          const p = decodeTokenUsage(params);

          if (!ours(p)) return;
          const { last, modelContextWindow } = p.tokenUsage;
          emit(
            HarnessEvent.ContextUsed({
              usedTokens: last.totalTokens,
              windowTokens: modelContextWindow,
            })
          );
        },
      ],
    ]);

    if (config.planLimits)
      notificationHandlers.set(RATE_LIMITS_UPDATED, onRateLimitsUpdated(config.planLimits));

    const handle = Incoming.$match({
      Request: (message) => handleRequest(message.id, message.method, message.params),
      Notification: (message) =>
        Effect.sync(() => notificationHandlers.get(message.method)?.(message.params)),
    });

    let closing = false;
    let finished = false;

    const finish = (error: string | null) => {
      if (finished) return;
      finished = true;
      emit(HarnessEvent.Exited({ error }));
      Queue.endUnsafe(events);
    };

    // Ends on its own when the connection closes (the app-server exited or dropped us).
    yield* Stream.fromQueue(conn.incoming).pipe(
      Stream.runForEach((message) => handle(message).pipe(Effect.ignore)),
      Effect.andThen(Deferred.await(conn.closed)),
      Effect.tap((reason) => Effect.sync(() => finish(closing ? null : reason))),
      Effect.forkScoped
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closing = true;
        yield* conn
          .request("thread/unsubscribe", {
            threadId,
          } satisfies P.ClientParams["thread/unsubscribe"])
          .pipe(Effect.timeout("2 seconds"), Effect.ignore);
        finish(null);
      })
    );

    // --- Commands ---------------------------------------------------------
    /** The Model and effort of the latest Turn Polaris sent; answers to async questions reuse them. */
    let chosen: Pick<TurnInput, "model" | "effort"> = {
      model: options.model,
      effort: options.effort,
    };

    /** Binds the Codex turn a request started to the Polaris Turn, and announces it. */
    const bindStarted = (codexTurnId: string, turnId: TurnId, prompt: string) => {
      if (!turns.has(codexTurnId)) turns.set(codexTurnId, turnId);
      announce(codexTurnId, prompt);

      if (!endedTurns.has(codexTurnId)) activeCodexTurn ??= codexTurnId;
    };

    /** `/compact` and `/review` (`slash.ts`): Codex's own calls, each running as a Turn. */
    const startHarnessCall = (turnId: TurnId, prompt: string, call: HarnessCall) =>
      Effect.gen(function* () {
        const result = yield* conn
          .request(call.method, call.params)
          .pipe(Effect.onError(() => Effect.sync(() => (pendingLocalTurn = null))));

        // Compaction's Turn arrives as `turn/started` and takes the pending Turn there.
        if (call.method === "thread/compact/start") return;
        pendingLocalTurn = null;
        const started = decodeReviewStart(result);

        if (started === null)
          return yield* codexError("Unexpected review/start response from Codex");
        bindStarted(started.turn.id, turnId, prompt);

        if (endedTurns.has(started.turn.id)) return;
        // Its inner turn may have started first and taken the Turn; the review's id is the one that ends.
        reviewTurn = started.turn.id;
        activeCodexTurn = started.turn.id;
      });

    const startTurn = (turnId: TurnId, prompt: string, input: ReturnType<typeof turnInput>) =>
      Effect.gen(function* () {
        if (activeCodexTurn !== null || pendingLocalTurn !== null)
          return yield* codexError("A Turn is already in progress; steer or interrupt it");
        const policy = policyFor(permissionMode, options.readOnly);
        pendingLocalTurn = { turnId, prompt };
        const call = harnessCallOf(prompt, threadId);

        if (call !== null) return yield* startHarnessCall(turnId, prompt, call);

        const params: P.ClientParams["turn/start"] = {
          threadId,
          input,
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: policy.approvalsReviewer,
          sandboxPolicy: sandboxPolicyFor(policy.sandbox),
        };

        // Codex keeps a Turn's overrides for the thread's later Turns; null leaves them as they are.
        if (chosen.model !== null) params.model = chosen.model;

        if (chosen.effort !== null) params.effort = chosen.effort;

        const { approvalsReviewer: _reviewer, effort: _effort, ...older } = params;

        const result = yield* requestCompat(conn, "turn/start", params, older).pipe(
          Effect.ensuring(Effect.sync(() => (pendingLocalTurn = null)))
        );

        const started = decodeTurnStart(result);

        if (started === null) return yield* codexError("Unexpected turn/start response from Codex");
        bindStarted(started.turn.id, turnId, prompt);
      });

    const steerText = (text: string) =>
      Effect.gen(function* () {
        const codexTurnId = activeCodexTurn;

        if (codexTurnId === null) return yield* codexError("No Turn is in progress to steer");
        yield* conn.request("turn/steer", {
          threadId,
          input: [{ type: "text", text, text_elements: [] }],
          expectedTurnId: codexTurnId,
        } satisfies P.ClientParams["turn/steer"]);
        const steer = steers.fromResponse(codexTurnId, text);

        if (steer !== null)
          emit(HarnessEvent.ItemCompleted({ turnId: turnFor(codexTurnId), item: steer }));
      });

    const session: HarnessSession = {
      events: Stream.fromQueue(events),
      sendTurn: (input: TurnInput) =>
        Effect.suspend(() => {
          chosen = { model: input.model, effort: input.effort };

          return startTurn(input.turnId, input.prompt, turnInput(input.prompt, input.attachments));
        }),
      steer: steerText,
      interrupt: Effect.suspend(() =>
        activeCodexTurn === null
          ? Effect.void
          : conn
              .request("turn/interrupt", {
                threadId,
                turnId: activeCodexTurn,
              } satisfies P.ClientParams["turn/interrupt"])
              .pipe(Effect.asVoid)
      ),
      respond: (requestId, decision) =>
        Effect.gen(function* () {
          const request = pending.get(requestId);

          if (request === undefined)
            return yield* codexError(
              `No open Codex request ${requestId}; it may have been resolved`
            );
          pending.delete(requestId);

          if (isRpc(request)) {
            yield* conn.respond(request.rpcId, request.respond(decision));

            return;
          }

          // Async questions are answered with a new user message, never an RPC response.
          if (!ApprovalDecision.guards.Answer(decision)) return;

          if (activeCodexTurn !== null) yield* steerText(decision.text);
          else yield* startTurn(newTurnId(), decision.text, turnInput(decision.text, []));
        }),
      setPermissionMode: (mode) =>
        Effect.sync(() => {
          // Applied with the next `turn/start`, whose overrides persist on the thread.
          permissionMode = mode;
        }),
      terminalCommand: Effect.succeed([
        config.codexPath,
        "resume",
        threadId,
        "--remote",
        `unix://${config.appServer.socketPath}`,
      ]),
    };

    return session;
  });
