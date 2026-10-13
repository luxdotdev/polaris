/** `SecureStorage`'s keys, failures and the sealer its file Layer seals with. */
import { Effect, Schema } from "effect";

/**
 * `<namespace>/<name>[/<name>…]`, one namespace per consumer: `github/tokens/1001`,
 * `languages/client-proof`. No segment starts with a dot, so a key never leaves its directory.
 */
export const SecretKey = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]+(\/[a-z0-9_-][a-z0-9._-]*)+$/)
);

export const UnavailableReason = Schema.Literals(["no-backend", "plaintext-backend"]);

export type UnavailableReason = typeof UnavailableReason.Type;

/** This machine has no store that can keep a secret for the user (`reason` says which way). */
export class SecureStorageUnavailable extends Schema.TaggedError<SecureStorageUnavailable>()(
  "SecureStorageUnavailable",
  { reason: UnavailableReason, message: Schema.String }
) {}

/** The key is malformed, or the OS refused to seal or open its record, or the disk failed. */
export class SecureStorageError extends Schema.TaggedError<SecureStorageError>()(
  "SecureStorageError",
  { key: Schema.String, message: Schema.String }
) {}

export const unavailable = (reason: UnavailableReason) =>
  new SecureStorageUnavailable({
    reason,
    message:
      reason === "plaintext-backend"
        ? "the only secret store is basic_text, which encrypts with a fixed password"
        : "this machine has no secret store for the user",
  });

const decodeKey = Schema.decodeUnknownEffect(SecretKey);

/** The key, checked: anything else fails before touching a store. */
export const checkKey = (key: string) =>
  decodeKey(key).pipe(
    Effect.mapError(() => new SecureStorageError({ key, message: "not a secret key" }))
  );

/** What `safeStorage` reports, as the store sees it. */
export type Backend = "ok" | UnavailableReason;

export interface Opened {
  readonly text: string;
  /** The OS key rotated: seal the record again. */
  readonly shouldReEncrypt: boolean;
}

/** Electron's `safeStorage` (async API), or a stand-in in tests. */
export interface Sealer {
  readonly backend: () => Promise<Backend>;
  readonly seal: (plain: string) => Promise<Uint8Array>;
  readonly open: (sealed: Uint8Array) => Promise<Opened>;
}

export interface BackendFacts {
  readonly encryptionAvailable: boolean;
  readonly platform: NodeJS.Platform;
  /** `safeStorage.getSelectedStorageBackend()`; only meaningful on Linux. */
  readonly selectedBackend: () => string;
}

/** On Linux, `basic_text` "encrypts" with a hardcoded password: refuse it. */
export const backendOf = (facts: BackendFacts): Backend => {
  if (!facts.encryptionAvailable) return "no-backend";

  if (facts.platform === "linux" && facts.selectedBackend() === "basic_text")
    return "plaintext-backend";

  return "ok";
};
