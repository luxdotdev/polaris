/**
 * Handler for `harness.commands`: a Harness's Skills and Slash Commands in a
 * directory, read through its driver and cached per Harness and directory.
 * Nothing runs at idle: an answer older than `STALE_MS` is served as is and
 * read again in the background, and `refresh` reads again before answering.
 * Concurrent askers share one listing; a failed listing is never cached.
 */
import {
  type HarnessKind,
  HarnessCommands,
  HarnessUnavailable,
  isKnownHarness,
  type ListHarnessCommands,
  NotFound,
} from "@polaris/protocol";
import { Clock, Effect } from "effect";
import { HarnessRegistry } from "../services.ts";

export const STALE_MS = 60_000;

type Listing = Effect.Effect<HarnessCommands, NotFound | HarnessUnavailable>;

/** Lets a listing's failure handler find the entry made for it. */
interface Slot {
  entry: Entry | null;
}

interface Entry {
  readonly listing: Listing;
  readonly at: number;
  revalidating: boolean;
}

type Payload = typeof ListHarnessCommands.payloadSchema.Type;

const fetchCommands = (harness: HarnessKind, cwd: string) =>
  Effect.gen(function* () {
    const registry = yield* HarnessRegistry;

    const driver = yield* registry
      .get(harness)
      .pipe(Effect.mapError(() => new NotFound({ what: "harness", id: harness })));

    const commands = yield* (driver.listCommands?.(cwd) ?? Effect.succeed([])).pipe(
      Effect.mapError((error) => new HarnessUnavailable({ harness, message: error.message }))
    );

    return new HarnessCommands({
      harness,
      cwd,
      commands: [...commands],
      fetchedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });
  });

/** `harness.commands` with its cache. */
export const commandLists = Effect.gen(function* () {
  const registry = yield* HarnessRegistry;
  const cache = new Map<string, Entry>();

  const read = (harness: HarnessKind, cwd: string) =>
    fetchCommands(harness, cwd).pipe(Effect.provideService(HarnessRegistry, registry));

  const fresh = (key: string, harness: HarnessKind, cwd: string) =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const mine: Slot = { entry: null };

      const once = yield* Effect.cached(
        read(harness, cwd).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              if (cache.get(key) === mine.entry) cache.delete(key);
            })
          )
        )
      );

      mine.entry = { listing: once, at, revalidating: false };
      cache.set(key, mine.entry);

      return once;
    });

  /** Re-reads a stale entry once in the background; the old answer stays until it lands. */
  const revalidate = (key: string, entry: Entry, harness: HarnessKind, cwd: string) =>
    Effect.gen(function* () {
      if (entry.revalidating) return;
      entry.revalidating = true;

      yield* read(harness, cwd).pipe(
        Effect.flatMap((result) =>
          Effect.map(Clock.currentTimeMillis, (at) => {
            cache.set(key, { listing: Effect.succeed(result), at, revalidating: false });
          })
        ),
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            entry.revalidating = false;
          })
        ),
        Effect.forkDetach
      );
    });

  return Effect.fn("harness.commands")(function* ({ harness, cwd, refresh }: Payload) {
    if (!isKnownHarness(harness)) return yield* new NotFound({ what: "harness", id: harness });
    const key = `${harness}\u0000${cwd}`;
    const entry = refresh ? undefined : cache.get(key);

    if (entry === undefined) return yield* yield* fresh(key, harness, cwd);

    if ((yield* Clock.currentTimeMillis) - entry.at > STALE_MS)
      yield* revalidate(key, entry, harness, cwd);

    return yield* entry.listing;
  });
});
