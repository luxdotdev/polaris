// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- The closed RPC/feed tables decode untrusted values before dispatch and delivery.
import * as P from "@polaris/protocol";
import { Effect, Stream, Schema, Option, Result } from "effect";
import { languageSessionAuthority, type LiveSession } from "../HostConnection.ts";
import {
  decodeLanguage,
  languageFailure,
  languageMethods,
  languageFeeds,
  type LanguageMethod,
  type LanguageFeed,
  type LanguageTransport,
} from "./index.ts";

const waitAbort = (signal: AbortSignal) =>
  Effect.callback<void>((resume) => {
    const abort = () => resume(Effect.void);

    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });

    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

const runCall = async <A>(effect: Effect.Effect<A, unknown>, signal: AbortSignal): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(effect), { signal });

  return Result.match(result, {
    onSuccess: (value) => value,
    onFailure: (error) => {
      throw error;
    },
  });
};

/** Uses the authenticated existing session only; never creates an RPC client/parser/socket. */
export const languageTransportFor = (
  session: LiveSession,
  current?: () => LiveSession | null
): LanguageTransport | null => {
  const authority = languageSessionAuthority(session);

  if (authority === null || !authority.capabilities.some((c) => c.startsWith("languages")))
    return null;

  const ensure = () => {
    if (
      languageSessionAuthority(session) !== authority ||
      (current !== undefined && current() !== session)
    )
      throw languageFailure("not-connected");
  };

  const gate = (method: keyof typeof P.LANGUAGE_RPC_CAPABILITIES, value: unknown) => {
    ensure();

    if (!P.languageRpcAllowed(method, authority.capabilities))
      throw languageFailure("unsupported-capability");

    const routed = Schema.decodeUnknownOption(
      Schema.Struct({
        clientId: Schema.optionalKey(Schema.String),
        context: Schema.optionalKey(P.LanguageContextIdentity),
        fence: Schema.optionalKey(P.LanguageRequestFence),
      })
    )(value);

    if (Option.isNone(routed)) throw languageFailure("invalid-input");
    const context = routed.value.context ?? routed.value.fence?.context;

    if (
      (routed.value.clientId !== undefined &&
        routed.value.clientId !== authority.identity.clientId) ||
      (context !== undefined &&
        (context.hostId !== authority.identity.hostId ||
          context.clientId !== authority.identity.clientId))
    )
      throw languageFailure("not-owner");
  };

  const client = session.client;

  const calls: Record<LanguageMethod, (input: unknown) => Effect.Effect<unknown, unknown>> = {
    "languages.catalog": (input) =>
      client["languages.catalog"](decodeLanguage(P.GetLanguageCatalog.payloadSchema, input)),
    "languages.availability": (input) =>
      client["languages.availability"](
        decodeLanguage(P.GetLanguageAvailability.payloadSchema, input)
      ),
    "languages.install": (input) =>
      client["languages.install"](decodeLanguage(P.InstallLanguageTool.payloadSchema, input)),
    "languages.install.cancel": (input) =>
      client["languages.install.cancel"](
        decodeLanguage(P.CancelLanguageInstall.payloadSchema, input)
      ),
    "languages.discover": (input) =>
      client["languages.discover"](decodeLanguage(P.DiscoverLanguageProject.payloadSchema, input)),
    "languages.trust.get": (input) =>
      client["languages.trust.get"](decodeLanguage(P.GetLanguageTrust.payloadSchema, input)),
    "languages.trust.set": (input) =>
      client["languages.trust.set"](decodeLanguage(P.SetLanguageTrust.payloadSchema, input)),
    "languages.context.acquire": (input) =>
      client["languages.context.acquire"](
        decodeLanguage(P.AcquireLanguageContext.payloadSchema, input)
      ),
    "languages.context.release": (input) =>
      client["languages.context.release"](
        decodeLanguage(P.ReleaseLanguageContext.payloadSchema, input)
      ),
    "languages.context.restart": (input) =>
      client["languages.context.restart"](
        decodeLanguage(P.RestartLanguageContext.payloadSchema, input)
      ),
    "languages.document.sync": (input) =>
      client["languages.document.sync"](
        decodeLanguage(P.SyncLanguageDocument.payloadSchema, input)
      ),
    "languages.document.acknowledge": (input) =>
      client["languages.document.acknowledge"](
        decodeLanguage(P.AcknowledgeLanguageDocument.payloadSchema, input)
      ),
    "languages.edit.prepare": (input) =>
      client["languages.edit.prepare"](decodeLanguage(P.PrepareLanguageEdit.payloadSchema, input)),
    "languages.request": (input) =>
      client["languages.request"](decodeLanguage(P.RequestLanguageFeature.payloadSchema, input)),
    "languages.cancel": (input) =>
      client["languages.cancel"](decodeLanguage(P.CancelLanguageRequest.payloadSchema, input)),
    "languages.progress.cancel": (input) =>
      client["languages.progress.cancel"](
        decodeLanguage(P.CancelLanguageProgress.payloadSchema, input)
      ),
    "languages.server.respond": (input) =>
      client["languages.server.respond"](
        decodeLanguage(P.RespondLanguageServer.payloadSchema, input)
      ),
    "languages.context.configure": (input) =>
      client["languages.context.configure"](
        decodeLanguage(P.ConfigureLanguageContext.payloadSchema, input)
      ),
    "languages.format": (input) =>
      client["languages.format"](decodeLanguage(P.PreflightLanguageFormat.payloadSchema, input)),
    "languages.edit.decide": (input) =>
      client["languages.edit.decide"](decodeLanguage(P.AcceptLanguageEdit.payloadSchema, input)),
    "languages.operation.get": (input) =>
      client["languages.operation.get"](
        decodeLanguage(P.GetLanguageOperation.payloadSchema, input)
      ),
    "languages.operation.recover": (input) =>
      client["languages.operation.recover"](
        decodeLanguage(P.RecoverLanguageOperation.payloadSchema, input)
      ),
    "languages.tree.edit.decide": (input) =>
      client["languages.tree.edit.decide"](
        decodeLanguage(P.DecideLanguageTreeEdit.payloadSchema, input)
      ),
    "languages.tree.operation.get": (input) =>
      client["languages.tree.operation.get"](
        decodeLanguage(P.GetLanguageTreeOperation.payloadSchema, input)
      ),
    "languages.tree.operation.recover": (input) =>
      client["languages.tree.operation.recover"](
        decodeLanguage(P.RecoverLanguageTreeOperation.payloadSchema, input)
      ),
    "languages.preview.media": (input) =>
      client["languages.preview.media"](
        decodeLanguage(P.ReadLanguagePreviewMedia.payloadSchema, input)
      ),
  };

  const feeds: Record<LanguageFeed, (input: unknown) => Stream.Stream<unknown, unknown>> = {
    "languages.context.watch": (input) =>
      client["languages.context.watch"](
        decodeLanguage(P.WatchLanguageContext.payloadSchema, input)
      ),
    "languages.install.watch": (input) =>
      client["languages.install.watch"](
        decodeLanguage(P.WatchLanguageInstall.payloadSchema, input)
      ),
    "languages.availability.watch": (input) =>
      client["languages.availability.watch"](
        decodeLanguage(P.WatchLanguageAvailability.payloadSchema, input)
      ),
  };

  const safeFailure = (error: unknown, signal: AbortSignal) =>
    signal.aborted
      ? languageFailure("not-connected")
      : error instanceof P.LanguageError
        ? languageFailure(error.reason)
        : languageFailure("server-failed");

  return {
    ...authority.identity,
    capabilities: authority.capabilities,
    signal: authority.signal,
    invoke: async (method, value, signal) => {
      const input = decodeLanguage(languageMethods[method].payloadSchema, value);
      gate(method, input);
      const joined = AbortSignal.any([signal, authority.signal]);

      try {
        const value = await runCall(calls[method](input), joined);
        ensure();

        return decodeLanguage(languageMethods[method].successSchema, value);
      } catch (error) {
        throw safeFailure(error, joined);
      }
    },
    watch: async function* (kind, value, signal) {
      const input = decodeLanguage(languageFeeds[kind].input, value);
      gate(kind, input);
      const joined = AbortSignal.any([signal, authority.signal]);

      try {
        for await (const item of Stream.toAsyncIterable(
          feeds[kind](input).pipe(Stream.interruptWhen(waitAbort(joined)))
        )) {
          ensure();

          if (joined.aborted) return;
          yield decodeLanguage(languageFeeds[kind].item, item);
        }
      } catch (error) {
        throw safeFailure(error, joined);
      }
    },
    takeBlob: async (id, requestedBytes, signal) => {
      ensure();
      const maxBytes = decodeLanguage(Schema.Int, requestedBytes);
      const blobId = decodeLanguage(P.BlobId, id);

      if (maxBytes <= 0 || maxBytes > 10 * 1024 * 1024) throw languageFailure("too-large");
      const joined = AbortSignal.any([signal, authority.signal]);
      const chunks: Uint8Array[] = [];
      let bytes = 0;

      try {
        await runCall(
          Stream.runForEach(session.blobs.takeStream(blobId), (chunk) =>
            Effect.try({
              try: () => {
                bytes += chunk.length;

                if (bytes > maxBytes) throw languageFailure("too-large");
                chunks.push(chunk);
              },
              catch: () => languageFailure("too-large"),
            })
          ),
          joined
        );
        ensure();
        const result = new Uint8Array(bytes);
        let offset = 0;

        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        return result;
      } catch (error) {
        throw safeFailure(error, joined);
      }
    },
  };
};
