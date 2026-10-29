/**
 * Auto-archive (ENG-384): an hourly sweep archives Dormant sessions that have gone the Host's
 * `afterDays` without activity, through the same `ArchiveSession` dispatch as the user's.
 * Pinned sessions, Reviewer and walkthrough sessions, and sessions in an open Constellation stay.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AutoArchiveSettings,
  Command,
  CommandId,
  type Constellation,
  DEFAULT_AUTO_ARCHIVE_DAYS,
  FileError,
  type SessionId,
} from "@polaris/protocol";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
} from "effect";
import { paths } from "../paths.ts";
import type { ReadModel, SessionRecord } from "../store/model.ts";
import { Dispatcher } from "./dispatch.ts";
import { EngineConfig, EngineRuntime } from "./runtime.ts";

/** Who the archive reads as in the log: Polaris, not a Client device. */
export const AUTO_ARCHIVE_DEVICE = "Polaris (auto-archive)";

export const DEFAULT_SETTINGS = AutoArchiveSettings.make({ afterDays: DEFAULT_AUTO_ARCHIVE_DAYS });

const DAY_MS = 24 * 60 * 60 * 1000;

const SettingsJson = Schema.fromJsonString(AutoArchiveSettings);

const decode = Schema.decodeUnknownOption(SettingsJson);

const encode = Schema.encodeSync(SettingsJson);

const loadSettings = (path: string) =>
  Effect.promise(() => readFile(path, "utf8").catch(() => null)).pipe(
    Effect.map((text) =>
      text === null ? DEFAULT_SETTINGS : Option.getOrElse(decode(text), () => DEFAULT_SETTINGS)
    )
  );

/** Written to a temporary file and renamed, so a crash never leaves half a file. */
const saveSettings = (path: string, settings: AutoArchiveSettings) =>
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
        message: `Could not save the auto-archive settings: ${String(cause)}`,
      }),
  });

/** What the sweep reads of the model: the sessions, and who each Constellation holds. */
export interface ArchiveView {
  readonly sessions: ReadModel["sessions"];
  readonly constellations: ReadonlyMap<
    string,
    {
      readonly graph: Pick<Constellation, "state" | "leadSessionId"> & {
        readonly attempts: ReadonlyArray<{ readonly sessionId: SessionId }>;
      };
    }
  >;
}

/** Sessions a Constellation still needs: its Lead and its workers, until it completes. */
export const inOpenConstellation = (
  model: Pick<ArchiveView, "constellations">
): ReadonlySet<SessionId> => {
  const held = new Set<SessionId>();

  for (const { graph } of model.constellations.values()) {
    if (graph.state === "completed" || graph.state === "archived") continue;
    held.add(graph.leadSessionId);

    for (const attempt of graph.attempts) held.add(attempt.sessionId);
  }

  return held;
};

/** The sessions to archive now, oldest activity first. */
export const dueForArchive = (
  model: ArchiveView,
  settings: AutoArchiveSettings,
  now: number
): ReadonlyArray<SessionRecord> => {
  if (settings.afterDays === null) return [];
  const cutoff = now - settings.afterDays * DAY_MS;
  const held = inOpenConstellation(model);

  return [...model.sessions.values()]
    .filter(
      ({ session }) =>
        session.state === "dormant" &&
        session.pinnedAt == null &&
        session.origin == null &&
        !held.has(session.id) &&
        Date.parse(session.updatedAt) <= cutoff
    )
    .toSorted((a, b) => Date.parse(a.session.updatedAt) - Date.parse(b.session.updatedAt));
};

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const { dispatch } = yield* Dispatcher;
  const config = yield* EngineConfig;
  const path = config.autoArchiveSettingsPath ?? join(paths().root, "auto-archive-settings.json");
  const current = yield* Ref.make(yield* loadSettings(path));
  const serial = yield* Semaphore.make(1);

  /** Keyed by the session's last activity: a repeat replays the receipt, an Unarchive starts over. */
  const archive = (record: SessionRecord) =>
    dispatch({
      commandId: CommandId.make(`auto-archive:${record.session.id}:${record.session.updatedAt}`),
      command: Command.cases.ArchiveSession.make({
        sessionId: record.session.id,
        deleteMergedBranch: false,
      }),
      deviceLabel: AUTO_ARCHIVE_DEVICE,
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("auto-archive failed", cause)));

  const sweep = serial.withPermits(1)(
    Effect.gen(function* () {
      const due = dueForArchive(
        yield* rt.store.model,
        yield* Ref.get(current),
        yield* Clock.currentTimeMillis
      );

      yield* Effect.forEach(due, archive, { discard: true });

      if (due.length > 0) yield* Effect.logInfo(`auto-archived ${due.length} dormant sessions`);
    })
  );

  const interval = config.autoArchiveSweepInterval;

  const start =
    interval === null
      ? Effect.void
      : sweep.pipe(
          Effect.repeat(Schedule.spaced(interval ?? Duration.hours(1))),
          Effect.forkIn(rt.engineScope),
          Effect.asVoid
        );

  const setSettings = (settings: AutoArchiveSettings) =>
    Effect.gen(function* () {
      yield* saveSettings(path, settings);
      yield* Ref.set(current, settings);
      yield* Effect.forkIn(sweep, rt.engineScope);
    });

  return AutoArchive.of({ start, settings: Ref.get(current), setSettings });
});

export class AutoArchive extends Context.Service<
  AutoArchive,
  {
    /** Sweep now, then every hour. */
    readonly start: Effect.Effect<void>;
    readonly settings: Effect.Effect<AutoArchiveSettings>;
    /** Saves the settings on the Host and sweeps with them at once. */
    readonly setSettings: (settings: AutoArchiveSettings) => Effect.Effect<void, FileError>;
  }
>()("polaris/daemon/engine/AutoArchive") {
  static readonly layer = Layer.effect(AutoArchive, make);
}
