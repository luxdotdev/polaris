/**
 * The files a Secret Request's value lands in (ADR 0089): one per secret under
 * `<root>/<sessionId>/`, mode 0600 in 0700 directories, deleted after `ttlMs` by
 * one timer per live secret (and a sweep on start), so an idle Daemon never wakes.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SECRET_TTL_MS, SessionId, TurnItem } from "@polaris/protocol";
import { Duration, Effect, Redacted, Schema } from "effect";

export class SessionSecretError extends Schema.TaggedError<SessionSecretError>()(
  "SessionSecretError",
  { message: Schema.String }
) {}

/** What stands in for a live secret in anything Polaris records. */
export const REDACTED = "[secret]";

/** Shorter values would match ordinary text, so they aren't redacted. */
const MIN_REDACTED_LENGTH = 6;

export interface SessionSecretFiles {
  /** A fresh path for a secret of this session; nothing is written yet. */
  readonly reserve: (sessionId: SessionId) => string;
  readonly write: (
    sessionId: SessionId,
    path: string,
    value: Redacted.Redacted<string>
  ) => Effect.Effect<void, SessionSecretError>;
  /** Deletes one secret, written or not. */
  readonly discard: (path: string) => Effect.Effect<void>;
  /** Deletes every secret of the session (it was archived or removed). */
  readonly forget: (sessionId: SessionId) => Effect.Effect<void>;
  /** `item` with each live secret of the session replaced by `[secret]`, in every field. */
  readonly redact: (sessionId: SessionId, item: TurnItem) => TurnItem;
}

/** `text` with each secret, as JSON escapes it, replaced by `[secret]`. */
const replaceAll = (json: string, secrets: ReadonlyArray<string>) =>
  secrets.reduce(
    (acc, secret) => acc.split(JSON.stringify(secret).slice(1, -1)).join(REDACTED),
    json
  );

const decodeItem = Schema.decodeUnknownSync(Schema.fromJsonString(TurnItem));

const failed = (message: string) => (cause: unknown) =>
  new SessionSecretError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const removeQuietly = (path: string) =>
  Effect.promise(() => rm(path, { force: true, recursive: true }).catch(() => undefined));

/** The store, swept and with its timers armed; timers end with the scope. */
export const sessionSecretFiles = Effect.fn("sessionSecretFiles")(function* (
  root: string,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {}
) {
  const ttlMs = options.ttlMs ?? SECRET_TTL_MS;
  const now = options.now ?? Date.now;
  const scope = yield* Effect.scope;
  /** Live values by session, then by path. */
  const live = new Map<SessionId, Map<string, string>>();

  const drop = (sessionId: SessionId, path: string) => {
    const paths = live.get(sessionId);
    paths?.delete(path);

    if (paths?.size === 0) live.delete(sessionId);
  };

  const discard = (path: string) =>
    Effect.suspend(() => {
      for (const [sessionId, paths] of live) if (paths.has(path)) drop(sessionId, path);

      return removeQuietly(path);
    });

  const arm = (sessionId: SessionId, path: string, value: string, remainingMs: number) =>
    Effect.suspend(() => {
      const paths = live.get(sessionId) ?? new Map<string, string>();
      paths.set(path, value);
      live.set(sessionId, paths);

      return Effect.sleep(Duration.millis(Math.max(0, remainingMs))).pipe(
        Effect.andThen(discard(path)),
        Effect.forkIn(scope),
        Effect.asVoid
      );
    });

  // Sweep: delete what expired while the Daemon was down; re-arm the rest.
  const sessions = yield* Effect.promise(() => readdir(root).catch(() => []));

  for (const name of sessions) {
    const sessionId = SessionId.make(name);
    const dir = join(root, name);
    const files = yield* Effect.promise(() => readdir(dir).catch(() => []));

    for (const file of files) {
      const path = join(dir, file);
      const info = yield* Effect.promise(() => stat(path).catch(() => null));
      const remaining = info === null ? 0 : info.mtimeMs + ttlMs - now();

      if (info === null || !info.isFile() || remaining <= 0 || file.endsWith(".tmp")) {
        yield* removeQuietly(path);
        continue;
      }

      const value = yield* Effect.promise(() => readFile(path, "utf8").catch(() => null));

      if (value === null) yield* removeQuietly(path);
      else yield* arm(sessionId, path, value, remaining);
    }
  }

  const files: SessionSecretFiles = {
    reserve: (sessionId) => join(root, sessionId, randomBytes(16).toString("hex")),
    write: (sessionId, path, value) =>
      Effect.tryPromise({
        try: async () => {
          const dir = join(root, sessionId);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await chmod(root, 0o700);
          await chmod(dir, 0o700);
          const temporary = `${path}.tmp`;
          await writeFile(temporary, Redacted.value(value), { mode: 0o600, flag: "wx" });
          await rename(temporary, path);
        },
        catch: failed("could not save the secret"),
      }).pipe(Effect.andThen(arm(sessionId, path, Redacted.value(value), ttlMs))),
    discard,
    forget: (sessionId) =>
      Effect.suspend(() => {
        live.delete(sessionId);

        return removeQuietly(join(root, sessionId));
      }),
    redact: (sessionId, item) => {
      const secrets = [...(live.get(sessionId)?.values() ?? [])].filter(
        (secret) => secret.length >= MIN_REDACTED_LENGTH
      );

      if (secrets.length === 0) return item;
      const json = JSON.stringify(item);
      const redacted = replaceAll(json, secrets);

      return redacted === json ? item : decodeItem(redacted);
    },
  };

  return files;
});
