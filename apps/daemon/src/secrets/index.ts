/**
 * The Host's secure storage (ADR 0079): provider keys the Daemon uses on the
 * user's behalf, by namespaced key (`voice/deepgram`). The macOS Keychain on
 * a Mac, a file only the user can read elsewhere; values never leave the Host.
 */
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { polarisHome } from "../paths.ts";
import { CommandRunner } from "../service/CommandRunner.ts";

export type SecretStore = "keychain" | "file";

export class SecretStorageError extends Schema.TaggedError<SecretStorageError>()(
  "SecretStorageError",
  { store: Schema.Literals(["keychain", "file"]), message: Schema.String }
) {}

/** Lowercase segments separated by `/`, none starting with a dot. */
const SECRET_KEY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/**
 * Values are tokens: printable ASCII without spaces or quotes, so they pass
 * `security -i`'s parser unquoted and can't break out of its command line.
 */
export const SECRET_VALUE = /^[A-Za-z0-9._~+/=-]{1,4096}$/;

let fileStoreForTests = false;

/** Only `main.testing.ts` calls this; no environment variable selects the file store. */
export const useFileSecretsForTests = () => {
  fileStoreForTests = true;
};

export class HostSecrets extends Context.Service<
  HostSecrets,
  {
    readonly store: SecretStore;
    readonly get: (
      key: string
    ) => Effect.Effect<Option.Option<Redacted.Redacted<string>>, SecretStorageError>;
    readonly set: (
      key: string,
      value: Redacted.Redacted<string>
    ) => Effect.Effect<void, SecretStorageError>;
    /** Removing a missing secret is fine. */
    readonly remove: (key: string) => Effect.Effect<void, SecretStorageError>;
  }
>()("polaris/daemon/secrets/HostSecrets") {
  /** The Keychain on macOS, `~/.polaris/secrets` elsewhere or under `main.testing.ts`. */
  static readonly layer = Layer.suspend(() =>
    process.platform === "darwin" && !fileStoreForTests
      ? Layer.effect(HostSecrets, keychainSecrets()).pipe(Layer.provide(CommandRunner.layer))
      : Layer.succeed(HostSecrets)(fileSecrets(join(polarisHome(), "secrets")))
  );

  static readonly memory = () => Layer.succeed(HostSecrets)(memorySecrets());
}

const checkKey = (store: SecretStore, key: string) =>
  SECRET_KEY.test(key)
    ? Effect.void
    : Effect.fail(new SecretStorageError({ store, message: `not a secret key: ${key}` }));

const checkValue = (store: SecretStore, value: Redacted.Redacted<string>) =>
  SECRET_VALUE.test(Redacted.value(value))
    ? Effect.void
    : Effect.fail(
        new SecretStorageError({ store, message: "the value has characters a key never has" })
      );

export const memorySecrets = (): HostSecrets["Service"] => {
  const values = new Map<string, Redacted.Redacted<string>>();

  return HostSecrets.of({
    store: "file",
    get: (key) => Effect.sync(() => Option.fromNullishOr(values.get(key))),
    set: (key, value) =>
      Effect.andThen(checkValue("file", value), () => Effect.sync(() => values.set(key, value))),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  });
};

/** `security`'s exit status when the item is not in the keychain. */
const ITEM_NOT_FOUND = 44;

const SECURITY = "/usr/bin/security";

/**
 * Generic passwords under the service `dev.lux.polaris`, the key as the
 * account. `keychain` is a keychain file for tests; by default the user's.
 * `security`'s stderr can echo its command line, so it is never reported.
 */
export const keychainSecrets = (options: { readonly keychain?: string } = {}) =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner;
    const service = "dev.lux.polaris";
    const target = options.keychain === undefined ? [] : [options.keychain];

    const failed = (what: string, code: number) =>
      new SecretStorageError({
        store: "keychain",
        message: `the Keychain refused to ${what} (security exited ${code}); is it unlocked?`,
      });

    const get = (key: string) =>
      Effect.gen(function* () {
        yield* checkKey("keychain", key);

        const result = yield* runner.run([
          SECURITY,
          "find-generic-password",
          "-s",
          service,
          "-a",
          key,
          "-w",
          ...target,
        ]);

        if (result.code === ITEM_NOT_FOUND) return Option.none<Redacted.Redacted<string>>();

        if (result.code !== 0) return yield* failed("read the key", result.code);

        return Option.some(Redacted.make(result.stdout.replace(/\n$/, "")));
      });

    return HostSecrets.of({
      store: "keychain",
      get,
      set: (key, value) =>
        Effect.gen(function* () {
          yield* checkKey("keychain", key);
          yield* checkValue("keychain", value);
          // Through stdin, so the value never shows in another process's argv.
          const line = ["add-generic-password", "-U", "-s", service, "-a", key, "-w"];
          const command = [...line, Redacted.value(value), ...target].join(" ");
          const result = yield* runner.run([SECURITY, "-i"], { stdin: `${command}\n` });

          if (result.code !== 0) return yield* failed("store the key", result.code);
          // `security -i` exits 0 even when its command fails, so read the value back.
          const stored = yield* get(key);

          if (Option.isNone(stored) || Redacted.value(stored.value) !== Redacted.value(value))
            return yield* failed("store the key", result.code);
        }),
      remove: (key) =>
        Effect.gen(function* () {
          yield* checkKey("keychain", key);

          const result = yield* runner.run([
            SECURITY,
            "delete-generic-password",
            "-s",
            service,
            "-a",
            key,
            ...target,
          ]);

          if (result.code !== 0 && result.code !== ITEM_NOT_FOUND)
            return yield* failed("remove the key", result.code);
        }),
    });
  });

const fileFailed = (message: string) => (cause: unknown) =>
  new SecretStorageError({
    store: "file",
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/**
 * One file per key, `<dir>/<key>.secret`, mode 0600 in 0700 directories,
 * written through a temporary sibling and a rename. A link is never followed.
 */
export const fileSecrets = (dir: string): HostSecrets["Service"] => {
  const pathOf = (key: string) => join(dir, `${key}.secret`);

  return HostSecrets.of({
    store: "file",
    get: (key) =>
      Effect.andThen(checkKey("file", key), () =>
        Effect.tryPromise({
          try: async () => {
            const handle = await open(pathOf(key), constants.O_RDONLY | constants.O_NOFOLLOW).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return null;
                throw error;
              }
            );

            if (handle === null) return Option.none<Redacted.Redacted<string>>();

            try {
              const text = await handle.readFile("utf8");

              return Option.some(Redacted.make(text.trim()));
            } finally {
              await handle.close();
            }
          },
          catch: fileFailed("could not read the key"),
        })
      ),
    set: (key, value) =>
      Effect.andThen(Effect.all([checkKey("file", key), checkValue("file", value)]), () =>
        Effect.tryPromise({
          try: async () => {
            const path = pathOf(key);
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await chmod(dir, 0o700);
            const temporary = `${path}.${process.pid}.tmp`;
            await writeFile(temporary, Redacted.value(value), { mode: 0o600, flag: "wx" });
            await rename(temporary, path);
          },
          catch: fileFailed("could not store the key"),
        })
      ),
    remove: (key) =>
      Effect.andThen(checkKey("file", key), () =>
        Effect.tryPromise({
          try: async () => {
            const path = pathOf(key);
            const stat = await lstat(path).catch(() => null);

            if (stat !== null) await rm(path);
          },
          catch: fileFailed("could not remove the key"),
        })
      ),
  });
};
