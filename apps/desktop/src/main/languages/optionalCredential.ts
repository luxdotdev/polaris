/**
 * The language identity proof: 32 random bytes in `SecureStorage` as `languages/client-proof`,
 * so the OS user's key guards it on every platform (ADR 0044, bug B5).
 */
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Redacted, Schema } from "effect";
import { SecureStorage } from "../secure/index.ts";
import { LEGACY_PROOF_FILE, loadLanguageCredential } from "./credential.ts";

export const LANGUAGE_PROOF_KEY = "languages/client-proof";

const ProofText = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const decodeProof = Schema.decodeUnknownEffect(ProofText);

/** No proof could be loaded or made; language identity stays off. Never carries the secret. */
export class LanguageProofUnavailable extends Schema.TaggedError<LanguageProofUnavailable>()(
  "LanguageProofUnavailable",
  { message: Schema.String }
) {}

export interface LanguageProofInput {
  /** `<userData>/language-private`, the POSIX-only proof file from before `SecureStorage`. */
  readonly legacyDirectory: string;
  readonly platform: NodeJS.Platform;
}

const refuse = (message: string) => () => new LanguageProofUnavailable({ message });

const redact = (proof: string) => Redacted.make(proof, { label: "language identity" });

/** The POSIX file store's mode, owner and link checks; they can never pass on Windows. */
const posixFile = (input: LanguageProofInput) =>
  input.platform === "win32"
    ? Effect.fail(new LanguageProofUnavailable({ message: "no secret store on this machine" }))
    : Effect.try({
        try: () => loadLanguageCredential(input.legacyDirectory),
        catch: refuse("the private proof file is unsafe"),
      });

/** A legacy proof file that passes the POSIX checks, moved into the store unchanged. */
const legacyProof = (input: LanguageProofInput) =>
  input.platform !== "win32" && existsSync(join(input.legacyDirectory, LEGACY_PROOF_FILE))
    ? Effect.map(posixFile(input), (proof) => Option.some(Redacted.value(proof)))
    : Effect.succeedNone;

/** Loads the proof, or makes one when there is none; a stored one that won't open is never replaced. */
export const loadLanguageProof = Effect.fn("loadLanguageProof")(function* (
  input: LanguageProofInput
) {
  const storage = yield* SecureStorage;

  // Linux without a keyring keeps the POSIX file, as before SecureStorage.
  if (!(yield* storage.available)) return yield* posixFile(input);

  const stored = yield* storage
    .get(LANGUAGE_PROOF_KEY)
    .pipe(Effect.mapError(refuse("the stored proof can't be opened")));

  if (Option.isSome(stored))
    return redact(yield* Effect.mapError(decodeProof(stored.value), refuse("corrupt proof")));

  const adopted = yield* legacyProof(input);
  const proof = Option.getOrElse(adopted, () => randomBytes(32).toString("hex"));

  yield* storage
    .set(LANGUAGE_PROOF_KEY, proof)
    .pipe(Effect.mapError(refuse("the proof can't be stored")));

  if (Option.isSome(adopted))
    yield* Effect.ignore(
      Effect.try(() => rmSync(join(input.legacyDirectory, LEGACY_PROOF_FILE), { force: true }))
    );

  return redact(proof);
});

/** An unavailable proof disables language identity without changing ordinary Client startup. */
export const optionalLanguageCredential = (
  input: LanguageProofInput,
  warn: (message: string) => void
) =>
  loadLanguageProof(input).pipe(
    Effect.map((proof) => ({ clientIdentity: { proof } })),
    Effect.catch(() =>
      Effect.sync(() => {
        warn("Language identity unavailable: private credential could not be loaded");

        return {};
      })
    )
  );
