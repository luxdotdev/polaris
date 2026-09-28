/**
 * One Agent Session's view of one Codex thread on the shared app-server.
 *
 * Each session opens its own connection, starts or rejoins its thread
 * (`thread/start` / `thread/resume`), and translates that thread's
 * notifications and server→client requests into `HarnessEvent`s. Because the
 * thread lives in the shared app-server, a `codex --remote` TUI can attach to
 * it at the same time; Turns the TUI starts show up here too.
 */
import { type ApprovalDecision, type PermissionMode, RequestId, TurnId } from "@polaris/protocol";
import { type Cause, Deferred, Effect, Option, Queue, Schema, type Scope, Stream } from "effect";
import type {
  HarnessError,
  HarnessEvent,
  HarnessSession,
  OpenOptions,
  TurnInput,
} from "../HarnessDriver.ts";
import type { AppServer } from "./AppServer.ts";
import {
  approvalDecision,
  elicitationDecision,
  permissionsDecision,
  policyFor,
  sandboxPolicyFor,
  toPlanItem,
  toTurnItem,
  turnInput,
  userInputDecision,
  userMessageText,
} from "./mapping.ts";
import * as P from "./protocol.ts";
import { codexError, type Incoming, type RpcConnection } from "./RpcConnection.ts";

export interface SessionConfig {
  readonly appServer: AppServer;
  readonly codexPath: string;
  readonly clientVersion: string;
}

type PendingRequest =
  | {
      readonly _tag: "Rpc";
      readonly rpcId: P.RpcId;
      readonly respond: (decision: ApprovalDecision) => unknown;
    }
  /** An async question in an agent message; answered with a new user message. */
  | { readonly _tag: "AsyncQuestion" };

const decode =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (input: unknown): S["Type"] | null =>
    Option.getOrNull(Schema.decodeUnknownOption(schema)(input) as Option.Option<S["Type"]>);

const decodeThread = decode(P.ThreadResponse);

const decodeTurnStart = decode(P.TurnStartResponse);

const decodeTurnStarted = decode(P.TurnStartedNotification);

const decodeTurnCompleted = decode(P.TurnCompletedNotification);

const decodeItem = decode(P.ItemNotification);

const decodeDelta = decode(P.DeltaNotification);

const decodePlan = decode(P.TurnPlanUpdatedNotification);

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

    let permissionMode: PermissionMode = options.permissionMode;
    const policy = policyFor(permissionMode);

    const common = {
      cwd: options.cwd,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandbox: policy.sandbox,
      ...(options.model === null ? {} : { model: options.model }),
    };

    const threadResult =
      options.resumeCursor === null
        ? yield* conn.request("thread/start", {
            ...common,
            serviceName: "polaris",
          } satisfies P.ClientParams["thread/start"])
        : yield* conn.request("thread/resume", {
            ...common,
            threadId: options.resumeCursor,
            excludeTurns: true,
          } satisfies P.ClientParams["thread/resume"]);

    const thread = decodeThread(threadResult);

    if (thread === null) return yield* codexError("Unexpected thread/start response from Codex");
    const threadId = thread.thread.id;
    emit({ _tag: "CursorAssigned", cursor: threadId });

    // --- Turn bookkeeping -------------------------------------------------
    const turns = new Map<string, TurnId>(); // Codex turn id → Polaris TurnId
    /** Codex turns whose `TurnStarted` was emitted. */
    const announced = new Set<string>();
    const plans = new Map<string, (typeof P.TurnPlanUpdatedNotification.Type)["plan"]>();
    let activeCodexTurn: string | null = null;
    /** A Turn Polaris is starting (`turn/start` in flight), with the prompt it sent. */
    let pendingLocalTurn: { readonly turnId: TurnId; readonly prompt: string } | null = null;
    const endedTurns = new Set<string>();
    let errorCount = 0;

    const announce = (codexTurnId: string, prompt: string | null) => {
      const turnId = turns.get(codexTurnId);

      if (turnId === undefined || announced.has(codexTurnId)) return;
      announced.add(codexTurnId);
      emit({ _tag: "TurnStarted", turnId, prompt });
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

      return mapped === null || mapped._tag === "AssistantMessage" || mapped._tag === "Reasoning"
        ? null
        : mapped;
    };

    // --- Approvals --------------------------------------------------------
    const pending = new Map<RequestId, PendingRequest>();
    const byRpcId = new Map<string, RequestId>();

    const openRequest = (
      rpcId: P.RpcId,
      codexTurnId: string,
      request: {
        readonly kind: "command" | "file-change" | "tool" | "question";
        readonly title: string;
        readonly detail: string | null;
        readonly options: ReadonlyArray<string>;
        readonly respond: (decision: ApprovalDecision) => unknown;
      }
    ) => {
      const requestId = newRequestId();
      pending.set(requestId, { _tag: "Rpc", rpcId, respond: request.respond });
      byRpcId.set(String(rpcId), requestId);
      emit({
        _tag: "ApprovalRequested",
        turnId: turnFor(codexTurnId),
        requestId,
        kind: request.kind,
        title: request.title,
        detail: request.detail,
        options: request.options,
      });
    };

    const handleRequest = (id: P.RpcId, method: string, params: unknown) => {
      const invalid = () => conn.respondError(id, -32602, `Polaris could not read ${method}`);

      switch (method) {
        case "item/commandExecution/requestApproval": {
          const p = decodeCommandApproval(params);

          if (p === null) return invalid();
          openRequest(id, p.turnId, {
            kind: "command",
            title: p.command ?? "Run a command",
            detail: p.reason ?? p.cwd ?? null,
            options: [],
            respond: approvalDecision,
          });

          return Effect.void;
        }

        case "item/fileChange/requestApproval": {
          const p = decodeFileApproval(params);

          if (p === null) return invalid();
          openRequest(id, p.turnId, {
            kind: "file-change",
            title: p.grantRoot ? `Allow writes under ${p.grantRoot}` : "Apply file changes",
            detail: p.reason ?? null,
            options: [],
            respond: approvalDecision,
          });

          return Effect.void;
        }

        case "item/permissions/requestApproval": {
          const p = decodePermissions(params);

          if (p === null) return invalid();
          openRequest(id, p.turnId, {
            kind: "tool",
            title: "Grant additional permissions",
            detail: [p.reason, JSON.stringify(p.permissions)].filter(Boolean).join("\n"),
            options: [],
            respond: (decision) => permissionsDecision(p.permissions, decision),
          });

          return Effect.void;
        }

        case "item/tool/requestUserInput": {
          const p = decodeUserInput(params);

          if (p === null) return invalid();
          openRequest(id, p.turnId, {
            kind: "question",
            title: p.questions.map((q) => q.question).join("\n"),
            detail: p.questions.map((q) => q.header).join(" · ") || null,
            options: p.questions[0]?.options?.map((o) => o.label) ?? [],
            respond: (decision) => userInputDecision(p.questions, decision),
          });

          return Effect.void;
        }

        case "mcpServer/elicitation/request": {
          const p = decodeElicitation(params);

          if (p === null) return invalid();
          openRequest(id, p.turnId ?? activeCodexTurn ?? "", {
            kind: "tool",
            title: `${p.serverName}: ${p.message}`,
            detail: null,
            options: [],
            respond: elicitationDecision,
          });

          return Effect.void;
        }

        default:
          // Dynamic tools, attestation and ChatGPT token refresh are never enabled by Polaris,
          // and Polaris never handles credentials.
          return conn.respondError(id, -32601, `Polaris does not handle ${method}`);
      }
    };

    // --- Notifications ----------------------------------------------------
    const ours = (p: { readonly threadId: string } | null) => p !== null && p.threadId === threadId;

    const handleNotification = (method: string, params: unknown) => {
      switch (method) {
        case "thread/name/updated": {
          const p = decodeName(params);

          if (ours(p) && p?.threadName) emit({ _tag: "TitleSuggested", title: p.threadName });

          return;
        }

        case "turn/started": {
          const p = decodeTurnStarted(params);

          if (!ours(p) || p === null) return;
          activeCodexTurn = p.turn.id;
          // A Turn started elsewhere is announced with its user message, which comes next.
          turnFor(p.turn.id, { announce: false });

          return;
        }

        case "item/started": {
          const p = decodeItem(params);

          if (!ours(p) || p === null) return;

          if (p.item.type === "userMessage") {
            turnFor(p.turnId, { announce: false });
            announce(p.turnId, userMessageText(p.item));

            return;
          }

          const turnId = turnFor(p.turnId);
          const item = progressOf(p.item);

          if (item !== null) emit({ _tag: "ItemUpdated", turnId, item });

          return;
        }

        case "item/agentMessage/delta":
        case "item/plan/delta":
        case "item/reasoning/summaryTextDelta":
        case "item/reasoning/textDelta":
        case "item/commandExecution/outputDelta": {
          const p = decodeDelta(params);

          if (!ours(p) || p === null) return;
          emit({
            _tag: "ItemDelta",
            turnId: turnFor(p.turnId),
            itemId: p.itemId,
            field: method === "item/commandExecution/outputDelta" ? "output" : "text",
            text: p.delta,
          });

          return;
        }

        case "item/completed": {
          const p = decodeItem(params);

          if (!ours(p) || p === null) return;

          if (p.item.type === "userMessage") {
            turnFor(p.turnId, { announce: false });
            announce(p.turnId, userMessageText(p.item));

            return;
          }

          const turnId = turnFor(p.turnId);
          const item = toTurnItem(p.item);

          if (item !== null) emit({ _tag: "ItemCompleted", turnId, item });

          if (
            p.item.type === "agentMessage" &&
            "delivery" in p.item &&
            p.item.delivery === "async" &&
            p.item.questions
          ) {
            for (const question of p.item.questions) {
              const requestId = newRequestId();
              pending.set(requestId, { _tag: "AsyncQuestion" });
              emit({
                _tag: "ApprovalRequested",
                turnId,
                requestId,
                kind: "question",
                title: question.title,
                detail: null,
                options: question.options ?? [],
              });
            }
          }

          return;
        }

        case "turn/plan/updated": {
          const p = decodePlan(params);

          if (!ours(p) || p === null) return;
          plans.set(p.turnId, p.plan);
          emit({
            _tag: "ItemUpdated",
            turnId: turnFor(p.turnId),
            item: toPlanItem(`${p.turnId}:plan`, p.plan),
          });

          return;
        }

        case "error": {
          const p = decodeError(params);

          if (!ours(p) || p === null || p.willRetry) return;
          emit({
            _tag: "ItemCompleted",
            turnId: turnFor(p.turnId),
            item: {
              _tag: "Error",
              id: `${p.turnId}:error:${++errorCount}`,
              message: p.error.message,
            },
          });

          return;
        }

        case "serverRequest/resolved": {
          const p = decodeResolved(params);

          if (p === null) return;
          const requestId = byRpcId.get(String(p.requestId));

          if (requestId === undefined) return;
          byRpcId.delete(String(p.requestId));

          // Still pending means someone else (the TUI, or Codex itself) resolved it.
          if (pending.delete(requestId)) emit({ _tag: "ApprovalWithdrawn", requestId });

          return;
        }

        case "turn/completed": {
          const p = decodeTurnCompleted(params);

          if (!ours(p) || p === null) return;
          const turnId = turnFor(p.turn.id);
          const plan = plans.get(p.turn.id);

          if (plan !== undefined) {
            emit({ _tag: "ItemCompleted", turnId, item: toPlanItem(`${p.turn.id}:plan`, plan) });
            plans.delete(p.turn.id);
          }

          endedTurns.add(p.turn.id);

          if (activeCodexTurn === p.turn.id) activeCodexTurn = null;
          emit({
            _tag: "TurnEnded",
            turnId,
            status: p.turn.status === "inProgress" ? "completed" : p.turn.status,
            error: p.turn.error?.message ?? null,
          });

          return;
        }

        default:
          return;
      }
    };

    const handle = (message: Incoming) =>
      message._tag === "Request"
        ? handleRequest(message.id, message.method, message.params)
        : Effect.sync(() => handleNotification(message.method, message.params));

    let closing = false;
    let finished = false;

    const finish = (error: string | null) => {
      if (finished) return;
      finished = true;
      emit({ _tag: "Exited", error });
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
    const startTurn = (turnId: TurnId, prompt: string, input: ReturnType<typeof turnInput>) =>
      Effect.gen(function* () {
        if (activeCodexTurn !== null || pendingLocalTurn !== null)
          return yield* codexError("A Turn is already in progress; steer or interrupt it");
        const policy = policyFor(permissionMode);
        pendingLocalTurn = { turnId, prompt };

        const result = yield* conn
          .request("turn/start", {
            threadId,
            input,
            approvalPolicy: policy.approvalPolicy,
            approvalsReviewer: policy.approvalsReviewer,
            sandboxPolicy: sandboxPolicyFor(policy.sandbox),
            ...(options.model === null ? {} : { model: options.model }),
          } satisfies P.ClientParams["turn/start"])
          .pipe(Effect.ensuring(Effect.sync(() => (pendingLocalTurn = null))));

        const started = decodeTurnStart(result);

        if (started === null) return yield* codexError("Unexpected turn/start response from Codex");

        if (!turns.has(started.turn.id)) turns.set(started.turn.id, turnId);
        announce(started.turn.id, prompt);

        if (!endedTurns.has(started.turn.id)) activeCodexTurn ??= started.turn.id;
      });

    const steerText = (text: string) =>
      Effect.gen(function* () {
        if (activeCodexTurn === null) return yield* codexError("No Turn is in progress to steer");
        yield* conn.request("turn/steer", {
          threadId,
          input: [{ type: "text", text, text_elements: [] }],
          expectedTurnId: activeCodexTurn,
        } satisfies P.ClientParams["turn/steer"]);
      });

    const session: HarnessSession = {
      events: Stream.fromQueue(events),
      sendTurn: (input: TurnInput) =>
        startTurn(input.turnId, input.prompt, turnInput(input.prompt, input.attachments)),
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

          if (request._tag === "Rpc") {
            yield* conn.respond(request.rpcId, request.respond(decision));

            return;
          }

          // Async questions are answered with a new user message, never an RPC response.
          if (decision._tag !== "Answer") return;

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
