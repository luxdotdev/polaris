/**
 * `SecureStorage`: the Desktop App's secrets at rest, one OS secure store on macOS,
 * Windows and Linux (ENG-290; ADR 0040 Q17, ADR 0044). See README.md.
 */
import { rm } from "node:fs/promises";
import { Context, Effect, Layer, Option } from "effect";
import { adoptAll, type FilesInput, pathOf, readSealed, writeAtomically } from "./files.ts";
import {
  type Backend,
  checkKey,
  SecureStorageError,
  type SecureStorageUnavailable,
  type UnavailableReason,
  unavailable,
} from "./model.ts";

export type { Adoption, FilesInput } from "./files.ts";

export {
  type Backend,
  backendOf,
  type Opened,
  type Sealer,
  SecretKey,
  SecureStorageError,
  SecureStorageUnavailable,
  UnavailableReason,
} from "./model.ts";

export interface SecureStorageApi {
  /** Whether `get` and `set` can work: false when there is no store, or only a plaintext one. */
  readonly available: Effect.Effect<boolean>;
  /** None when nothing is stored under `key`. */
  readonly get: (
    key: string
  ) => Effect.Effect<Option.Option<string>, SecureStorageError | SecureStorageUnavailable>;
  readonly set: (
    key: string,
    value: string
  ) => Effect.Effect<void, SecureStorageError | SecureStorageUnavailable>;
  /** Succeeds when nothing was stored; works even when the store is unavailable. */
  readonly delete: (key: string) => Effect.Effect<void, SecureStorageError>;
}

const memory = (): SecureStorageApi => {
  const records = new Map<string, string>();

  return {
    available: Effect.succeed(true),
    get: (key) => Effect.as(checkKey(key), Option.fromUndefinedOr(records.get(key))),
    set: (key, value) =>
      Effect.tap(checkKey(key), () => Effect.sync(() => records.set(key, value))),
    delete: (key) => Effect.tap(checkKey(key), () => Effect.sync(() => records.delete(key))),
  };
};

/** Sealed files under `input.dir`, adopting `input.adopt` first. */
const sealedFiles = Effect.fn("SecureStorage.files")(function* (input: FilesInput) {
  const { dir, sealer } = input;

  for (const adoption of input.adopt ?? []) {
    yield* Effect.promise(() => adoptAll(dir, adoption).catch(() => undefined));
  }

  const backend = Effect.promise(() => sealer.backend().catch((): Backend => "no-backend"));

  const ready = Effect.flatMap(backend, (state) =>
    state === "ok" ? Effect.void : Effect.fail(unavailable(state))
  );

  const attempt = <A>(key: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new SecureStorageError({ key, message: String(cause) }),
    });

  const seal = (key: string, value: string) =>
    Effect.flatMap(
      attempt(key, () => sealer.seal(value)),
      (sealed) => attempt(key, () => writeAtomically(pathOf(dir, key), sealed))
    );

  const get = Effect.fn("SecureStorage.get")(function* (key: string) {
    yield* checkKey(key);
    yield* ready;

    const sealed = yield* attempt(key, () => readSealed(pathOf(dir, key)));

    if (Option.isNone(sealed)) return Option.none<string>();

    const opened = yield* attempt(key, () => sealer.open(sealed.value));

    // A failed reseal leaves the old record, which still opens.
    if (opened.shouldReEncrypt) yield* Effect.ignore(seal(key, opened.text));

    return Option.some(opened.text);
  });

  const set = Effect.fn("SecureStorage.set")(function* (key: string, value: string) {
    yield* checkKey(key);
    yield* ready;
    yield* seal(key, value);
  });

  const remove = Effect.fn("SecureStorage.delete")(function* (key: string) {
    yield* checkKey(key);
    yield* attempt(key, () => rm(pathOf(dir, key), { force: true }));
  });

  return SecureStorage.of({
    available: Effect.map(backend, (state) => state === "ok"),
    get,
    set,
    delete: remove,
  });
});

const refusing = (reason: UnavailableReason): SecureStorageApi => ({
  available: Effect.succeed(false),
  get: (key) => Effect.andThen(checkKey(key), Effect.fail(unavailable(reason))),
  set: (key) => Effect.andThen(checkKey(key), Effect.fail(unavailable(reason))),
  delete: (key) => Effect.asVoid(checkKey(key)),
});

export class SecureStorage extends Context.Service<SecureStorage, SecureStorageApi>()(
  "polaris/desktop/SecureStorage"
) {
  /** Sealed files under `input.dir`; the app's sealer is `safeStorage` (`electron.ts`). */
  static readonly files = (input: FilesInput) => Layer.effect(SecureStorage, sealedFiles(input));

  /** In memory, for tests: one fresh store per build of the Layer. */
  static readonly memory = Layer.sync(SecureStorage, () => SecureStorage.of(memory()));

  /** A machine with no store (or only a plaintext one): every read and write refused. */
  static readonly unavailable = (reason: UnavailableReason) =>
    Layer.succeed(SecureStorage, SecureStorage.of(refusing(reason)));
}
