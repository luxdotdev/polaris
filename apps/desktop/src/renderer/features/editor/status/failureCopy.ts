import type * as P from "@polaris/protocol";
import { Match } from "effect";

/** Public failure messages may add detail; transport placeholders never become product copy. */
export const failureDetail = (message: string) => {
  const line = message.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";

  return line === "" ||
    /Language operation\s*:|^Language (?:runtime|server failed)|All fibers interrupted/.test(line)
    ? null
    : line;
};

export const failureReason = (reason: P.LanguageError["reason"] | "unknown", host: string) =>
  Match.value(reason).pipe(
    Match.when("not-connected", () => `Can't reach ${host}. Try again when it's back.`),
    Match.when("timeout", () => `No answer from ${host} in time. Try again.`),
    Match.when("cancelled", () => "The language tool check was cancelled. Try again."),
    Match.when("server-failed", () => "The language server couldn't start or stopped responding."),
    Match.when("install-failed", () => "Language tools couldn't be downloaded or checked."),
    Match.when("not-installed", () => "Language tools haven't been downloaded yet."),
    Match.when("missing-prerequisite", () => "A tool needed by this language is missing."),
    Match.when("awaiting-trust", () => "Trust this Workspace to run its language tools."),
    Match.whenOr(
      "not-owner",
      "stale-generation",
      "stale-document",
      "conflict",
      () => "The language tools changed while this request was running. Try again."
    ),
    Match.when("queue-full", () => "Language tools are busy. Try again in a moment."),
    Match.whenOr(
      "unsupported-platform",
      "unsupported-capability",
      "method-not-found",
      "not-offered",
      () => "These language tools aren't available on this Host."
    ),
    Match.when("recovery-required", () => "Language tools need recovery before they can run."),
    Match.when("audit-required", () => "This language tool needs approval before it can run."),
    Match.when("too-large", () => "This request exceeds the language tools' size limit."),
    Match.when("format-failed", () => "The formatter couldn't format this file."),
    Match.orElse(() => "Language tools couldn't complete this request. Try again.")
  );
