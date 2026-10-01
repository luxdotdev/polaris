/**
 * One Agent Session as one ACP session on the Harness's shared agent process.
 * Starts (`session/new`) or resumes (`session/resume`, else `session/load` with
 * its replay dropped) the session, runs each Turn as a `session/prompt`, and
 * translates the agent's updates and permission requests into `HarnessEvent`s.
 */
import {
  type ApprovalDecision,
  ApprovalDecision as Decision,
  type Attachment,
  harnessEntry,
  type PermissionMode,
  RequestId,
  type TurnId,
} from "@polaris/protocol";
import { pathToFileURL } from "node:url";
import { type Cause, Deferred, Effect, Option, Queue, Schema, type Scope, Stream } from "effect";
import {
  HarnessError,
  HarnessEvent,
  type HarnessSession,
  type OpenOptions,
  type TurnInput,
} from "../HarnessDriver.ts";
import type { AgentConnection } from "./AgentConnection.ts";
import type { AcpCommands } from "./commands.ts";
import { type AcpHarness, MODE_IDS } from "./harnesses.ts";
import { choices, configChange, effortOption, modelOption } from "./models.ts";
import {
  allowOnce,
  approvalKind,
  autoAllowed,
  describe,
  permissionResponse,
} from "./permissions.ts";
import * as P from "./protocol.ts";
import { newTranslator } from "./translate.ts";

export interface SessionConfig {
  readonly harness: AcpHarness;
  readonly binaryPath: string;
  readonly conn: AgentConnection;
  /** Where the commands the session reports go (`commands.ts`). */
  readonly commands?: AcpCommands;
}

interface PendingApproval {
  readonly rpcId: P.RpcId;
  readonly turnId: TurnId;
  readonly toolCallId: string;
  readonly options: ReadonlyArray<P.PermissionOption>;
}

const decodeUpdate = Schema.decodeUnknownOption(P.SessionUpdate);

const decodeCommands = Schema.decodeUnknownOption(P.AvailableCommandsUpdate);

const decodePermission = Schema.decodeUnknownOption(P.RequestPermissionParams);

const decodeNew = Schema.decodeUnknownEffect(P.NewSessionResponse);

const decodeLoad = Schema.decodeUnknownEffect(P.LoadSessionResponse);

const decodePrompt = Schema.decodeUnknownOption(P.PromptResponse);

/** How a Turn ends, as `TurnEnded` carries it. */
interface TurnEnd {
  readonly status: "completed" | "interrupted" | "failed";
  readonly error: string | null;
}

/** How a `session/prompt` that returned ends the Turn. */
const turnEnd = (name: string, stopReason: string): TurnEnd => {
  switch (stopReason) {
    case "end_turn":
      return { status: "completed", error: null };
    case "cancelled":
      return { status: "interrupted", error: null };
    case "max_tokens":
      return { status: "failed", error: `${name} ran out of output tokens` };
    case "max_turn_requests":
      return {
        status: "failed",
        error: `${name} reached its limit of model requests for one Turn`,
      };
    case "refusal":
      return { status: "failed", error: `${name} refused to continue` };
    default:
      return { status: "completed", error: null };
  }
};

/** The prompt as ACP content: text, then each attachment as a link to its staged file. */
const promptBlocks = (prompt: string, attachments: ReadonlyArray<Attachment>) => [
  { type: "text" as const, text: prompt },
  ...attachments.map((a) => ({
    type: "resource_link" as const,
    uri: pathToFileURL(a.hostPath).href,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
  })),
];

const harnessError = (harness: AcpHarness, message: string, cause?: unknown) =>
  new HarnessError(
    cause === undefined
      ? { harness: harness.kind, message }
      : { harness: harness.kind, message, cause }
  );

/** `session/new`; an agent that answers "auth required" isn't signed in (ADR 0001: it signs in itself). */
export const newSession = (conn: AgentConnection, harness: AcpHarness, cwd: string) => {
  const entry = harnessEntry(harness.kind);
  const name = entry?.name ?? harness.kind;

  return conn
    .call("session/new", { cwd, mcpServers: [] } satisfies P.ClientParams["session/new"])
    .pipe(
      Effect.catchTag("AgentRpcError", (e) =>
        Effect.fail(
          e.code === P.ErrorCode.authRequired
            ? harnessError(
                harness,
                `${name} isn't signed in on this host. ${entry?.setup.signIn ?? ""}`.trim(),
                e
              )
            : harnessError(harness, `session/new: ${e.message}`, e)
        )
      ),
      Effect.flatMap((result) =>
        Effect.mapError(decodeNew(result), (e) =>
          harnessError(harness, `Unexpected session/new response from ${name}`, e)
        )
      )
    );
};

/** The mode a permission mode selects among those a session offers, if any. */
const modeFor = (mode: PermissionMode, available: ReadonlyArray<string>): string | null =>
  MODE_IDS[mode].find((id) => available.includes(id)) ?? null;

export const openSession = (
  config: SessionConfig,
  options: OpenOptions
): Effect.Effect<HarnessSession, HarnessError, Scope.Scope> =>
  Effect.gen(function* () {
    const { conn, harness } = config;
    const name = harnessEntry(harness.kind)?.name ?? harness.kind;
    const fail = (message: string, cause?: unknown) => harnessError(harness, message, cause);
    const caps = conn.initialize.agentCapabilities;
    const scope = yield* Effect.scope;
    const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>();
    const emit = (event: HarnessEvent) => void Queue.offerUnsafe(events, event);

    let configOptions: ReadonlyArray<P.ConfigOption> = [];
    let modes: P.ModeState | null = null;
    let permissionMode: PermissionMode = options.permissionMode;
    let activeTurn: TurnId | null = null;
    /** True while `session/load` replays history the engine already has. */
    let replaying = false;
    const pending = new Map<RequestId, PendingApproval>();

    const translator = newTranslator(options.cwd, {
      emit,
      onModeChanged: (modeId) => {
        if (modes !== null) modes = { ...modes, currentModeId: modeId };
      },
      onConfigOptions: (next) => {
        configOptions = next;
      },
    });

    const onPermission = (rpcId: P.RpcId, params: P.RequestPermissionParams) => {
      const turnId = activeTurn;

      if (turnId === null || replaying)
        return conn.respond(rpcId, { outcome: { outcome: "cancelled" } });
      translator.toolCall(turnId, params.toolCall);

      if (autoAllowed(permissionMode, params.toolCall.kind))
        return conn.respond(rpcId, allowOnce(params.options));
      const requestId = RequestId.make(crypto.randomUUID());
      pending.set(requestId, {
        rpcId,
        turnId,
        toolCallId: params.toolCall.toolCallId,
        options: params.options,
      });
      emit(
        HarnessEvent.ApprovalRequested({
          turnId,
          requestId,
          kind: approvalKind(params.toolCall.kind),
          ...describe(params.toolCall),
          options: [],
        })
      );

      return Effect.void;
    };

    const onRequest = (rpcId: P.RpcId, method: string, params: P.RpcPayload) => {
      const permission =
        method === "session/request_permission" ? decodePermission(params) : Option.none();

      const handled = Option.isSome(permission)
        ? onPermission(rpcId, permission.value)
        : conn.respondError(rpcId, P.ErrorCode.methodNotFound, `Polaris does not handle ${method}`);

      Effect.runFork(Effect.ignore(handled));
    };

    const route = (sessionId: string) =>
      conn.route(sessionId, {
        onUpdate: (raw) => {
          const update = decodeUpdate(raw);

          if (Option.isSome(update) && !replaying) translator.update(activeTurn, update.value);
          const commands = decodeCommands(raw);

          if (Option.isSome(commands)) config.commands?.record(options.cwd, commands.value);
        },
        onRequest,
      });

    // --- Start or resume -------------------------------------------------
    const start = newSession(conn, harness, options.cwd);

    const resume = (sessionId: string) =>
      Effect.gen(function* () {
        const params = { sessionId, cwd: options.cwd, mcpServers: [] };

        yield* route(sessionId);

        if (caps?.sessionCapabilities?.resume != null)
          return yield* conn.request(
            "session/resume",
            params satisfies P.ClientParams["session/resume"]
          );
        replaying = true;

        return yield* conn
          .request("session/load", params satisfies P.ClientParams["session/load"])
          .pipe(Effect.ensuring(Effect.sync(() => (replaying = false))));
      }).pipe(
        Effect.flatMap((result) =>
          Effect.mapError(decodeLoad(result), (e) =>
            fail(`Unexpected resume response from ${name}`, e)
          )
        ),
        Effect.map((setup) => ({ sessionId, ...setup }))
      );

    const canResume = caps?.loadSession === true || caps?.sessionCapabilities?.resume != null;

    const session =
      options.resumeCursor !== null && canResume
        ? yield* resume(options.resumeCursor)
        : yield* start;

    const sessionId = session.sessionId;

    if (options.resumeCursor === null || !canResume) yield* route(sessionId);
    configOptions = session.configOptions ?? [];
    modes = session.modes ?? null;
    emit(HarnessEvent.CursorAssigned({ cursor: sessionId }));

    // --- Settings ----------------------------------------------------------
    const setConfig = (change: { readonly configId: string; readonly value: string } | null) =>
      change === null
        ? Effect.void
        : conn
            .request("session/set_config_option", {
              sessionId,
              ...change,
            } satisfies P.ClientParams["session/set_config_option"])
            .pipe(
              Effect.flatMap((result) =>
                Schema.decodeUnknownEffect(P.SetConfigOptionResponse)(result)
              ),
              Effect.tap((result) => Effect.sync(() => (configOptions = result.configOptions))),
              Effect.mapError((e) =>
                fail(`${name} rejected ${change.configId} = ${change.value}`, e)
              ),
              Effect.asVoid
            );

    const applyPermissionMode = Effect.suspend(() => {
      const modeConfig = configOptions.find((o) => o.category === "mode" && o.type === "select");

      if (modeConfig !== undefined) {
        const id = modeFor(
          permissionMode,
          choices(modeConfig).map((c) => c.value)
        );

        return setConfig(configChange(modeConfig, id));
      }

      const id =
        modes === null
          ? null
          : modeFor(
              permissionMode,
              modes.availableModes.map((m) => m.id)
            );

      if (modes === null || id === null || id === modes.currentModeId) return Effect.void;

      return conn
        .request("session/set_mode", {
          sessionId,
          modeId: id,
        } satisfies P.ClientParams["session/set_mode"])
        .pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              translator.update(null, { sessionUpdate: "current_mode_update", currentModeId: id })
            )
          ),
          Effect.asVoid
        );
    });

    /** Model first: a Model's effort choices can change with it. */
    const applyModel = (model: string | null, effort: string | null) =>
      Effect.suspend(() => setConfig(configChange(modelOption(configOptions), model))).pipe(
        Effect.andThen(
          Effect.suspend(() => setConfig(configChange(effortOption(configOptions), effort)))
        )
      );

    // A session mode is a second line of defence: Polaris answers requests by the mode anyway.
    yield* Effect.ignore(applyPermissionMode);
    yield* applyModel(options.model, options.effort);

    // --- Turns -------------------------------------------------------------
    const withdraw = (filter: (approval: PendingApproval) => boolean) =>
      Effect.forEach([...pending], ([requestId, approval]) => {
        if (!filter(approval)) return Effect.void;
        pending.delete(requestId);
        emit(HarnessEvent.ApprovalWithdrawn({ requestId }));

        return Effect.ignore(conn.respond(approval.rpcId, { outcome: { outcome: "cancelled" } }));
      });

    const endTurn = (turnId: TurnId, end: TurnEnd) =>
      Effect.gen(function* () {
        if (activeTurn !== turnId) return;
        yield* withdraw((approval) => approval.turnId === turnId);
        translator.endTurn(turnId);
        activeTurn = null;
        emit(HarnessEvent.TurnEnded({ turnId, ...end }));
      });

    const runPrompt = (input: TurnInput) =>
      conn
        .request("session/prompt", {
          sessionId,
          prompt: promptBlocks(input.prompt, input.attachments),
        } satisfies P.ClientParams["session/prompt"])
        .pipe(
          Effect.map((result) =>
            Option.match(decodePrompt(result), {
              onNone: () => turnEnd(name, "end_turn"),
              onSome: ({ stopReason }) => turnEnd(name, stopReason),
            })
          ),
          Effect.catch((e) => Effect.succeed({ status: "failed" as const, error: e.message })),
          Effect.flatMap((end) => endTurn(input.turnId, end))
        );

    const sendTurn = (input: TurnInput) =>
      Effect.gen(function* () {
        if (activeTurn !== null)
          return yield* fail("A Turn is already in progress; interrupt it first");
        yield* applyModel(input.model, input.effort);
        activeTurn = input.turnId;
        emit(HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }));
        // Started now, so `session/prompt` is written before any `session/cancel` can be.
        yield* Effect.forkIn(runPrompt(input), scope, { startImmediately: true });
      });

    const interrupt = Effect.suspend(() => {
      const turnId = activeTurn;

      if (turnId === null) return Effect.void;

      // ACP: after `session/cancel` the client answers its open permission requests as cancelled.
      return conn
        .notify("session/cancel", { sessionId } satisfies P.ClientParams["session/cancel"])
        .pipe(Effect.andThen(withdraw((approval) => approval.turnId === turnId)));
    });

    const respond = (requestId: RequestId, decision: ApprovalDecision) =>
      Effect.gen(function* () {
        const approval = pending.get(requestId);

        if (approval === undefined)
          return yield* fail(`No open ${name} request ${requestId}; it may have been resolved`);
        pending.delete(requestId);
        const response = permissionResponse(approval.options, decision);

        if (Decision.guards.Deny(decision) || response.outcome.outcome === "cancelled")
          translator.decline(approval.turnId, approval.toolCallId);
        yield* conn.respond(approval.rpcId, response);
      });

    // --- Lifetime ----------------------------------------------------------
    let finished = false;

    const finish = (error: string | null) => {
      if (finished) return;
      finished = true;
      emit(HarnessEvent.Exited({ error }));
      Queue.endUnsafe(events);
    };

    yield* Deferred.await(conn.closed).pipe(
      Effect.tap((reason) => Effect.sync(() => finish(reason))),
      Effect.forkScoped
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (activeTurn !== null) yield* Effect.ignore(interrupt);

        if (caps?.sessionCapabilities?.close != null)
          yield* conn
            .request("session/close", { sessionId } satisfies P.ClientParams["session/close"])
            .pipe(Effect.timeout("2 seconds"), Effect.ignore);
        finish(null);
      })
    );

    return {
      events: Stream.fromQueue(events),
      sendTurn,
      steer: () => Effect.fail(fail(`${name} can't take guidance mid-Turn; wait or interrupt`)),
      interrupt,
      respond,
      setPermissionMode: (mode) =>
        Effect.suspend(() => {
          permissionMode = mode;

          return applyPermissionMode;
        }),
      terminalCommand:
        harness.resumeArgs === null
          ? Effect.fail(fail(`${name} can't reopen this session in its own terminal`))
          : Effect.succeed([config.binaryPath, ...harness.resumeArgs(sessionId)]),
    } satisfies HarnessSession;
  });
