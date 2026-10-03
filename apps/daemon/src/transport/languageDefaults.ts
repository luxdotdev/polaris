import { LanguageError } from "@polaris/protocol";
import { Effect, Stream } from "effect";

const unavailable = () =>
  new LanguageError({
    reason: "unsupported-capability",
    message: "Language service is unavailable on this Daemon",
    retryable: false,
  });

const request = () => Effect.fail(unavailable());

const feed = () => Stream.fail(unavailable());

/** Typed defaults mount no services, processes or capabilities; real handler layers override them. */
export const languageDefaults = {
  "languages.catalog": request,
  "languages.availability": request,
  "languages.availability.watch": feed,
  "languages.install": request,
  "languages.install.cancel": request,
  "languages.install.watch": feed,
  "languages.discover": request,
  "languages.trust.get": request,
  "languages.trust.set": request,
  "languages.context.acquire": request,
  "languages.context.release": request,
  "languages.context.restart": request,
  "languages.context.watch": feed,
  "languages.document.sync": request,
  "languages.document.acknowledge": request,
  "languages.edit.prepare": request,
  "languages.request": request,
  "languages.cancel": request,
  "languages.progress.cancel": request,
  "languages.server.respond": request,
  "languages.context.configure": request,
  "languages.format": request,
  "languages.edit.decide": request,
  "languages.operation.get": request,
  "languages.operation.recover": request,
  "languages.tree.edit.decide": request,
  "languages.tree.operation.get": request,
  "languages.tree.operation.recover": request,
  "languages.preview.media": request,
};
