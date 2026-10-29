/**
 * Idle compaction (ENG-562): an Agent Session Idle or Dormant for `IDLE_COMPACTION_AFTER_MS`
 * since its last Turn, holding at least the setting's `minTokens`, is compacted with a
 * `CompactSession` while the prompt cache is warm. One sleeping fiber per such session and
 * nothing otherwise; the schedule is derived from the log, so a restart re-arms it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  Command,
  CommandId,
  DEFAULT_IDLE_COMPACTION,
  type DomainEvent,
  FileError,
  IDLE_COMPACTION_AFTER_MS,
  IdleCompactionSettings,
  PROMPT_CACHE_TTL_MS,
  type SessionId,
} from "@polaris/protocol";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Predicate,
  Ref,
  Schema,
  Stream,
} from "effect";
import { paths } from "../paths.ts";
import { lastTurn, type SessionRecord } from "../store/model.ts";
import { inOpenConstellation } from "./autoArchive.ts";
import { Dispatcher } from "./dispatch.ts";
import { EngineConfig, EngineRuntime } from "./runtime.ts";

/** Who the compaction reads as in the log: Polaris, not a Client device. */
export const IDLE_COMPACTION_DEVICE = "Polaris (idle compaction)";

const SettingsJson = Schema.fromJsonString(IdleCompactionSettings);

const decode = Schema.decodeUnknownOption(SettingsJson);

const encode = Schema.encodeSync(SettingsJson);

const loadSettings = (path: string) =>
  Effect.promise(() => readFile(path, "utf8").catch(() => null)).pipe(
    Effect.map((text) =>
      text === null
        ? DEFAULT_IDLE_COMPACTION
        : Option.getOrElse(decode(text), () => DEFAULT_IDLE_COMPACTION)
    )
  );

/** Written to a temporary file and renamed, so a crash never leaves half a file. */
const saveSettings = (path: string, settings: IdleCompactionSettings) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, encode(settings));
      await rename(temporary, path);
    },
    catch: (cause) =>
      new FileError({
        path,
        code: "EIO",
        message: `Could not save the idle compaction settings: ${String(cause)}`,
      }),
  });

/** What decides a session's compaction besides its record. */
export interface CompactionContext {
  readonly settings: IdleCompactionSettings;
  /** Sessions an open Constellation still holds: their Turns mean something to the Lead. */
  readonly held: ReadonlySet<SessionId>;
  readonly now: number;
}

/** Idle or Dormant with nothing in flight, pending or running in the background. */
const resting = (record: SessionRecord) => {
  const { session } = record;

  return (
    (session.state === "idle" || session.state === "dormant") &&
    record.pending.size === 0 &&
    session.backgroundTasks.length === 0
  );
};

/**
 * When this session is due a compaction, as a stable key, or null when it isn't: the user's
 * own sessions only, past the threshold, and never twice for the same last Turn.
 */
export const compactionDue = (record: SessionRecord | undefined, context: CompactionContext) => {
  const session = record?.session;
  const turn = record && lastTurn(record);
  const used = session?.contextUsage?.usedTokens ?? 0;

  if (
    !context.settings.enabled ||
    record === undefined ||
    session === undefined ||
    turn === undefined ||
    turn.endedAt === null ||
    turn.idleCompaction === true ||
    session.origin != null ||
    context.held.has(session.id) ||
    used < context.settings.minTokens ||
    !resting(record)
  )
    return null;

  const ended = Date.parse(turn.endedAt);

  // Past the cache's lifetime a compaction costs what the next Turn would; leave it to the Harness.
  if (context.now >= ended + PROMPT_CACHE_TTL_MS) return null;

  return {
    at: ended + IDLE_COMPACTION_AFTER_MS,
    key: `idle-compaction:${session.id}:${turn.id}`,
  };
};

/** The session whose schedule this event may move, or null. */
const watched = (event: DomainEvent): SessionId | null =>
  Match.value(event).pipe(
    Match.tags({
      TurnStarted: (e) => e.turn.sessionId,
      TurnEnded: (e) => e.turn.sessionId,
      ApprovalRequested: (e) => e.request.sessionId,
      ApprovalResolved: (e) => e.sessionId,
      SessionStateChanged: (e) => e.sessionId,
      SessionContextUsed: (e) => e.sessionId,
      SessionBackgroundTasksChanged: (e) => e.sessionId,
    }),
    Match.orElse(() => null)
  );

interface Timer {
  readonly key: string;
  readonly fiber: Fiber.Fiber<void>;
}

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const { dispatch } = yield* Dispatcher;
  const config = yield* EngineConfig;

  const path =
    config.idleCompactionSettingsPath ?? join(paths().root, "idle-compaction-settings.json");

  const current = yield* Ref.make(yield* loadSettings(path));
  const timers = new Map<SessionId, Timer>();

  const due = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const model = yield* rt.store.model;
      const record = model.sessions.get(sessionId);

      const found = compactionDue(record, {
        settings: yield* Ref.get(current),
        held: inOpenConstellation(model),
        now: yield* Clock.currentTimeMillis,
      });

      if (found === null || record === undefined) return null;
      const driver = yield* rt.registry.get(record.session.harness).pipe(Effect.option);

      return Option.isSome(driver) && driver.value.capabilities.compact === true ? found : null;
    });

  /** The key is the command id too: a repeat (or a restart mid-dispatch) replays the receipt. */
  const fire = (sessionId: SessionId, key: string) =>
    Effect.gen(function* () {
      timers.delete(sessionId);

      if ((yield* due(sessionId))?.key !== key) return;
      yield* dispatch({
        commandId: CommandId.make(key),
        command: Command.cases.CompactSession.make({ sessionId }),
        deviceLabel: IDLE_COMPACTION_DEVICE,
      });
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("idle compaction failed", cause)));

  const sync = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const next = yield* due(sessionId);
      const timer = timers.get(sessionId);

      if (timer?.key === next?.key) return;

      if (timer !== undefined) {
        timers.delete(sessionId);
        yield* Fiber.interrupt(timer.fiber);
      }

      if (next === null) return;
      const wait = Math.max(0, next.at - (yield* Clock.currentTimeMillis));

      const fiber = yield* Effect.sleep(Duration.millis(wait)).pipe(
        Effect.andThen(fire(sessionId, next.key)),
        Effect.forkIn(rt.engineScope)
      );

      timers.set(sessionId, { key: next.key, fiber });
    });

  const syncAll = Effect.gen(function* () {
    for (const sessionId of (yield* rt.store.model).sessions.keys()) yield* sync(sessionId);
  });

  const start = Effect.forkIn(
    Effect.scoped(
      Effect.gen(function* () {
        const live = yield* rt.store.subscribe({
          filter: (item) =>
            Predicate.isTagged(item, "Event") && watched(item.envelope.event) !== null,
        });

        // Subscribed first, so nothing committed between the scan and the feed is missed.
        yield* syncAll;

        yield* Stream.runForEach(live, (item) => {
          const sessionId = Predicate.isTagged(item, "Event") ? watched(item.envelope.event) : null;

          return sessionId === null ? Effect.void : sync(sessionId);
        });
      })
    ).pipe(Effect.forever),
    rt.engineScope
  ).pipe(Effect.asVoid);

  const setSettings = (settings: IdleCompactionSettings) =>
    Effect.gen(function* () {
      yield* saveSettings(path, settings);
      yield* Ref.set(current, settings);
      yield* syncAll;
    });

  return IdleCompaction.of({ start, settings: Ref.get(current), setSettings });
});

export class IdleCompaction extends Context.Service<
  IdleCompaction,
  {
    /** Follow the log and keep one timer per session due a compaction. */
    readonly start: Effect.Effect<void>;
    readonly settings: Effect.Effect<IdleCompactionSettings>;
    /** Saves the setting on the Host; the timers follow it at once. */
    readonly setSettings: (settings: IdleCompactionSettings) => Effect.Effect<void, FileError>;
  }
>()("polaris/daemon/engine/IdleCompaction") {
  static readonly layer = Layer.effect(IdleCompaction, make);
}
