import {
  LanguageCheckout,
  LanguagePath,
  LanguageError,
  LanguagePreviewMedia,
  ReadLanguagePreviewMedia,
} from "@polaris/protocol";
import { realpathSync } from "node:fs";
import { Context, Effect, Layer, Schema } from "effect";
import { BlobChannel } from "../../services.ts";
import { canonicalCheckout, checkoutKey, type CheckoutRegistration } from "../trust/checkout.ts";
import { checkSignal, mediaError, readMedia, resolvePaths, type MediaPhase } from "./files.ts";

export type MediaInput = typeof ReadLanguagePreviewMedia.payloadSchema.Type;

export type MediaResult = typeof LanguagePreviewMedia.Type;

/** Bind independently to the current authenticated connection and its live membership/generation. */
export class PreviewMediaAuthority extends Context.Service<
  PreviewMediaAuthority,
  {
    authorize: (checkout: LanguageCheckout, signal: AbortSignal) => Promise<CheckoutRegistration>;
  }
>()("polaris/languages/PreviewMediaAuthority") {}

const failure = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : mediaError("invalid-input", "Host media could not be read safely");

export interface PreviewMediaOptions {
  /** Shared Daemon admission bound, including work cleaning up after interruption. */
  maxConcurrent?: number;
  /** Test-only filesystem fault injection; omitted in production. */
  phase?: (phase: MediaPhase) => Promise<void>;
}

/** Singleton admission owner; authority and BlobChannel are looked up inside every request. */
export class HostPreviewMedia extends Context.Service<
  HostPreviewMedia,
  {
    read: (
      input: MediaInput
    ) => Effect.Effect<MediaResult, LanguageError, PreviewMediaAuthority | BlobChannel>;
  }
>()("polaris/languages/HostPreviewMedia") {
  static layer(options: PreviewMediaOptions = {}) {
    return Layer.sync(HostPreviewMedia, () => createHostPreviewMedia(options));
  }
}

export function createHostPreviewMedia(
  options: PreviewMediaOptions = {}
): HostPreviewMedia["Service"] {
  const limit = options.maxConcurrent ?? 4;

  if (!Number.isInteger(limit) || limit < 1 || limit > 4)
    throw mediaError("invalid-input", "Invalid media admission bound");
  let active = 0;
  const phase = options.phase ?? (() => Promise.resolve());

  return HostPreviewMedia.of({
    read: Effect.fn("HostPreviewMedia.read")(function* (input: MediaInput) {
      const decoded = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(ReadLanguagePreviewMedia.payloadSchema)(input),
        catch: failure,
      });

      const authority = yield* PreviewMediaAuthority;
      const blobs = yield* BlobChannel;
      let pending: Promise<unknown> = Promise.resolve();
      let cleanup = () => {};

      yield* Effect.acquireRelease(
        Effect.suspend(() => {
          if (active >= limit)
            return Effect.fail(mediaError("queue-full", "Host media admission limit reached"));
          active++;

          return Effect.void;
        }),
        () =>
          Effect.promise(async () => {
            // An interrupted Promise still owns its descriptors and byte reservation until finally runs.
            await pending.catch(() => undefined);

            try {
              cleanup();
            } finally {
              active--;
            }
          })
      );

      const prepared = yield* Effect.tryPromise({
        try: (signal) => {
          const operation = prepare(authority, decoded, signal, phase).then((result) => {
            cleanup = result.close;

            return result;
          });

          pending = operation;

          return operation;
        },
        catch: failure,
      });
      // Reauthorize with descriptors still held, immediately before the per-connection offer.

      const finalRegistration = yield* Effect.tryPromise({
        try: (signal) => {
          const operation = authority.authorize(decoded.checkout, signal);

          pending = operation;

          return operation;
        },
        catch: failure,
      });

      yield* Effect.try({
        try: () => {
          const registered = Schema.decodeUnknownSync(
            Schema.Struct({
              checkout: LanguageCheckout,
              workspacePath: LanguagePath,
            })
          )(finalRegistration);

          if (
            checkoutKey(registered.checkout) !== checkoutKey(decoded.checkout) ||
            realpathSync(registered.checkout.path) !== prepared.root ||
            realpathSync(decoded.checkout.path) !== prepared.root ||
            realpathSync(registered.workspacePath) !== prepared.workspaceRoot
          )
            throw mediaError("not-owner", "Registered checkout changed before media delivery");
          prepared.verify();
        },
        catch: failure,
      });
      const blobId = yield* blobs.offer(prepared.bytes);

      return LanguagePreviewMedia.make({
        uri: prepared.uri,
        mimeType: prepared.mimeType,
        bytes: prepared.bytes.byteLength,
        blobId,
      });
    }, Effect.scoped),
  });
}

async function prepare(
  authority: PreviewMediaAuthority["Service"],
  input: MediaInput,
  signal: AbortSignal,
  phase: (phase: MediaPhase) => Promise<void>
) {
  checkSignal(signal);
  const registry = (checkout: LanguageCheckout) => authority.authorize(checkout, signal);
  const canonical = await canonicalCheckout(registry, input.checkout);
  const paths = await resolvePaths(canonical.root, input);
  const result = await readMedia(paths, input, signal, phase);

  try {
    const current = await canonicalCheckout(registry, input.checkout);

    if (current.root !== canonical.root || current.workspaceRoot !== canonical.workspaceRoot)
      throw mediaError("not-owner", "Registered checkout changed during media request");
    checkSignal(signal);

    return { ...result, root: canonical.root, workspaceRoot: canonical.workspaceRoot };
  } catch (error) {
    result.close();
    throw error;
  }
}
