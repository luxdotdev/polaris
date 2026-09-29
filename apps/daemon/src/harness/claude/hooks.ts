/**
 * Following an Agent Session while it is In Terminal.
 *
 * Claude Code allows one writer per transcript, so "Open in terminal" closes the
 * SDK query and runs `claude --resume <id>` in a PTY. Polaris then follows along
 * through Claude Code HTTP hooks: the resumed `claude` gets `--settings <file>`
 * whose hooks POST each lifecycle event to a listener bound to 127.0.0.1, with a
 * per-session bearer token. Claude Code's HTTP hooks only take http(s) URLs (no
 * Unix sockets), hence loopback plus token.
 *
 * The token lives in the settings file (mode 0600), never in argv, so other local
 * users can't read it from the process list. Hooks only observe: every response is
 * an empty 200, so a hook never changes what the TUI decides, and a short timeout
 * keeps a stopped Daemon from stalling the TUI (connection errors are non-blocking).
 */
import { timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RequestId, type SessionId, TurnId, TurnItem } from "@polaris/protocol";
import { type Cause, Context, Effect, Layer, Option, Queue, Stream } from "effect";
import { paths } from "../../paths.ts";
import { HarnessError, HarnessEvent } from "../HarnessDriver.ts";
import { approvalKind, describeToolCall } from "./permissions.ts";
import { decodeHookBody, type HookBody, type ToolPayload } from "./payloads.ts";
import { planItem, toolItem } from "./translate.ts";

/** Hook events Polaris subscribes to while a session is In Terminal. */
export const FOLLOWED_HOOK_EVENTS = [
  // Carries the (possibly new) session id as soon as the TUI starts, resumes or `/clear`s.
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

const TOOL_EVENTS = new Set<string>(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

/** Seconds; hooks run synchronously in the TUI, so keep it short. */
export const HOOK_TIMEOUT_SECONDS = 5;

/** The settings object to pass to `claude --settings`. Merged with the user's own hooks. */
export const hookSettings = (options: { readonly url: string; readonly token: string }) => {
  const hook = {
    type: "http" as const,
    url: options.url,
    headers: { Authorization: `Bearer ${options.token}` },
    timeout: HOOK_TIMEOUT_SECONDS,
  };

  return {
    hooks: Object.fromEntries(
      FOLLOWED_HOOK_EVENTS.map((event) => [
        event,
        [TOOL_EVENTS.has(event) ? { matcher: "*", hooks: [hook] } : { hooks: [hook] }],
      ])
    ),
  };
};

/**
 * Turns hook POST bodies into `HarnessEvent`s for one session. Turns started in the
 * TUI get Polaris Turn ids minted here, with the typed prompt. Every hook carries the
 * TUI's current session id, reported as `CursorAssigned` whenever it changes, so the
 * engine resumes from where the TUI left off. Running tools and TodoWrite plans are
 * live progress (`ItemUpdated`); tools complete on PostToolUse, the plan when the
 * Turn ends. A permission prompt shown in the TUI becomes an
 * informational `ApprovalRequested` (Needs You); it is answered in the terminal and
 * withdrawn when the tool finishes, the Turn stops, or the user types again.
 */
export class HookTranslator {
  private turnId: TurnId | null = null;
  private cursor: string | null;
  private pendingPrompt: RequestId | null = null;
  private lastTool: { readonly name: string; readonly input: ToolPayload } | null = null;
  private plan: TurnItem | null = null;
  private ended = false;

  /** What each followed hook event does, by `hook_event_name`. */
  private readonly handlers = new Map<string, (body: HookBody, events: HarnessEvent[]) => void>([
    ["UserPromptSubmit", (body, events) => this.onPrompt(body, events)],
    ["PreToolUse", (body, events) => this.onPreToolUse(body, events)],
    ["PostToolUse", (body, events) => this.onPostToolUse(body, events, false)],
    ["PostToolUseFailure", (body, events) => this.onPostToolUse(body, events, true)],
    ["Notification", (body, events) => this.onNotification(body, events)],
    ["Stop", (body, events) => this.onStop(body, events)],
    ["SessionEnd", (_body, events) => this.onSessionEnd(events)],
  ]);

  constructor(
    private readonly options: {
      readonly cursor: string | null;
      readonly newTurnId?: () => TurnId;
      readonly newRequestId?: () => RequestId;
    }
  ) {
    this.cursor = options.cursor;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  private newTurnId(): TurnId {
    return this.options.newTurnId?.() ?? TurnId.make(crypto.randomUUID());
  }

  private withdraw(events: HarnessEvent[]): void {
    if (this.pendingPrompt !== null) {
      events.push(HarnessEvent.ApprovalWithdrawn({ requestId: this.pendingPrompt }));
      this.pendingPrompt = null;
    }
  }

  private ensureTurn(events: HarnessEvent[], prompt: string | null = null): TurnId {
    if (this.turnId === null) {
      this.turnId = this.newTurnId();
      events.push(HarnessEvent.TurnStarted({ turnId: this.turnId, prompt }));
    }

    return this.turnId;
  }

  private endTurn(events: HarnessEvent[], status: "completed" | "interrupted"): void {
    if (this.turnId === null) return;

    if (this.plan !== null) {
      events.push(HarnessEvent.ItemCompleted({ turnId: this.turnId, item: this.plan }));
      this.plan = null;
    }

    events.push(HarnessEvent.TurnEnded({ turnId: this.turnId, status, error: null }));
    this.turnId = null;
  }

  onHook(body: HookBody): HarnessEvent[] {
    // Subagent activity is summarized by the parent's own tool call.
    if (this.ended || body.agent_id !== null) return [];
    const events: HarnessEvent[] = [];

    if (body.session_id !== null && body.session_id !== this.cursor) {
      this.cursor = body.session_id;
      events.push(HarnessEvent.CursorAssigned({ cursor: body.session_id }));
    }

    if (body.hook_event_name !== null) this.handlers.get(body.hook_event_name)?.(body, events);

    return events;
  }

  private onPrompt(body: HookBody, events: HarnessEvent[]): void {
    this.withdraw(events);
    this.endTurn(events, "completed");
    this.ensureTurn(events, body.prompt);
  }

  private onSessionEnd(events: HarnessEvent[]): void {
    this.withdraw(events);
    this.endTurn(events, "interrupted");
    this.ended = true;
    events.push(HarnessEvent.Exited({ error: null }));
  }

  private onPreToolUse(body: HookBody, events: HarnessEvent[]): void {
    const turnId = this.ensureTurn(events);
    const id = body.tool_use_id;
    const name = body.tool_name ?? "unknown";
    this.lastTool = { name, input: body.tool_input };

    if (id === null || name === "TodoWrite") return;
    events.push(
      HarnessEvent.ItemUpdated({
        turnId,
        item: toolItem({
          id,
          name,
          input: body.tool_input,
          cwd: body.cwd ?? "",
          status: "running",
          resultText: null,
          structured: null,
        }),
      })
    );
  }

  private onPostToolUse(body: HookBody, events: HarnessEvent[], failed: boolean): void {
    this.withdraw(events);
    const turnId = this.ensureTurn(events);
    const id = body.tool_use_id;
    const name = body.tool_name ?? "unknown";

    if (id === null) return;

    if (name === "TodoWrite") {
      if (failed) return;
      this.plan = planItem(turnId, body.tool_input);
      events.push(HarnessEvent.ItemUpdated({ turnId, item: this.plan }));

      return;
    }

    events.push(
      HarnessEvent.ItemCompleted({
        turnId,
        item: toolItem({
          id,
          name,
          input: body.tool_input,
          cwd: body.cwd ?? "",
          status: failed ? (body.is_interrupt === true ? "declined" : "failed") : "completed",
          resultText: failed ? (body.error ?? "") : null,
          structured: failed ? null : body.tool_response,
        }),
      })
    );
  }

  private onNotification(body: HookBody, events: HarnessEvent[]): void {
    if (body.notification_type !== "permission_prompt" || this.pendingPrompt !== null) return;
    const turnId = this.ensureTurn(events);
    const requestId = this.options.newRequestId?.() ?? RequestId.make(crypto.randomUUID());
    this.pendingPrompt = requestId;
    const tool = this.lastTool;
    events.push(
      HarnessEvent.ApprovalRequested({
        turnId,
        requestId,
        kind: tool ? approvalKind(tool.name) : "tool",
        title: body.message ?? "Claude needs your permission",
        detail: tool ? describeToolCall(tool.name, tool.input).detail : null,
        options: [],
      })
    );
  }

  private onStop(body: HookBody, events: HarnessEvent[]): void {
    this.withdraw(events);
    const turnId = this.turnId;
    const text = body.last_assistant_message;

    if (turnId !== null && text)
      events.push(
        HarnessEvent.ItemCompleted({
          turnId,
          item: TurnItem.cases.AssistantMessage.make({ id: `stop:${turnId}`, text }),
        })
      );
    this.endTurn(events, "completed");
  }
}

const tokensEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
};

interface Registration {
  readonly token: string;
  readonly translator: HookTranslator;
  readonly queue: Queue.Queue<HarnessEvent, Cause.Done>;
  readonly settingsPath: string;
}

/**
 * The request handler, separate from the listener so it can be tested without a port.
 * Route: `POST /hooks/<sessionId>` with `Authorization: Bearer <token>`.
 */
export const makeHookHandler =
  (registrations: ReadonlyMap<string, Registration>) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = /^\/hooks\/([^/]+)$/.exec(url.pathname);

    if (request.method !== "POST" || !match) return new Response(null, { status: 404 });
    const registration = registrations.get(decodeURIComponent(match[1]!));
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

    if (!registration || !tokensEqual(token, registration.token))
      return new Response(null, { status: 401 });
    let body: Option.Option<HookBody>;

    try {
      body = decodeHookBody(await request.json());
    } catch {
      return new Response(null, { status: 400 });
    }

    const events = Option.match(body, {
      onNone: () => [],
      onSome: (hook) => registration.translator.onHook(hook),
    });

    for (const event of events) Queue.offerUnsafe(registration.queue, event);

    if (registration.translator.isEnded) Queue.endUnsafe(registration.queue);

    // An empty object: observe only, never decide for the TUI.
    return Response.json({});
  };

/**
 * The hook listener for all In Terminal Claude sessions on this Host. One per Daemon.
 *
 * - `prepare` (idempotent) mints a token and writes the settings file for a session;
 *   the Claude driver calls it from `terminalCommand`.
 * - `events` is the session's follow-along stream (single consumer), ending when the
 *   TUI's session ends.
 * - `release` forgets the session and deletes its settings file, on hand-back.
 */
export class ClaudeHookReceiver extends Context.Service<
  ClaudeHookReceiver,
  {
    readonly port: number;
    readonly prepare: (options: {
      readonly sessionId: SessionId;
      readonly cursor: string | null;
    }) => Effect.Effect<{ readonly settingsPath: string }, HarnessError>;
    readonly events: (sessionId: SessionId) => Stream.Stream<HarnessEvent>;
    readonly release: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()("polaris/daemon/harness/claude/ClaudeHookReceiver") {
  static readonly make = (options?: { readonly settingsDir?: string }) =>
    Effect.gen(function* () {
      const settingsDir = options?.settingsDir ?? join(paths().root, "hooks");
      const registrations = new Map<string, Registration>();
      const handler = makeHookHandler(registrations);

      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })),
        (server) =>
          Effect.promise(async () => {
            await server.stop(true);

            for (const r of registrations.values()) {
              Queue.endUnsafe(r.queue);
              await rm(r.settingsPath, { force: true });
            }

            registrations.clear();
          })
      );

      const port = server.port!;

      const prepare = Effect.fn("ClaudeHookReceiver.prepare")(function* (o: {
        readonly sessionId: SessionId;
        readonly cursor: string | null;
      }) {
        const existing = registrations.get(o.sessionId);

        if (existing) return { settingsPath: existing.settingsPath };
        const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
        const settingsPath = join(settingsDir, `${encodeURIComponent(o.sessionId)}.json`);
        const url = `http://127.0.0.1:${port}/hooks/${encodeURIComponent(o.sessionId)}`;
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(settingsDir, { recursive: true, mode: 0o700 });
            await writeFile(settingsPath, JSON.stringify(hookSettings({ url, token }), null, 2), {
              mode: 0o600,
            });
          },
          catch: (cause) =>
            new HarnessError({
              harness: "claude",
              message: "Could not write the terminal hook settings",
              cause,
            }),
        });
        const queue = yield* Queue.unbounded<HarnessEvent, Cause.Done>();
        registrations.set(o.sessionId, {
          token,
          translator: new HookTranslator({ cursor: o.cursor }),
          queue,
          settingsPath,
        });

        return { settingsPath };
      });

      const events = (sessionId: SessionId): Stream.Stream<HarnessEvent> => {
        const r = registrations.get(sessionId);

        return r ? Stream.fromQueue(r.queue) : Stream.empty;
      };

      const release = (sessionId: SessionId) =>
        Effect.promise(async () => {
          const r = registrations.get(sessionId);

          if (!r) return;
          registrations.delete(sessionId);
          Queue.endUnsafe(r.queue);
          await rm(r.settingsPath, { force: true });
        });

      return ClaudeHookReceiver.of({ port, prepare, events, release });
    });

  static readonly layer = Layer.effect(ClaudeHookReceiver, ClaudeHookReceiver.make());
}
