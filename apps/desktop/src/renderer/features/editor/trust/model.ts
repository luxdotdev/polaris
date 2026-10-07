import type * as P from "@polaris/protocol";
import { Match, Predicate } from "effect";

export type TrustStatus = typeof P.LanguageTrustStatus.Type;

/** The two answers the card offers; revoke, ask again and provider choice live in the palette. */
export type TrustDecision = "trust" | "decline";

export type TrustPhase =
  | { readonly kind: "asking" }
  | { readonly kind: "submitting"; readonly action: TrustDecision }
  | { readonly kind: "failed"; readonly action: TrustDecision; readonly error: P.LanguageError };

/** An open Trust ask for one scope: a Workspace (its Worktrees too) or a Review Checkout. */
export interface TrustAsk {
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly path: string;
  readonly status: TrustStatus;
  readonly phase: TrustPhase;
}

export const trustScopeKey = (hostKey: string, scope: typeof P.LanguageTrustScope.Type) =>
  JSON.stringify([hostKey, scope]);

/** The Daemon's decision; a record from before decisions existed reads from its boolean. */
export const decisionOf = (trust: typeof P.LanguageTrust.Type) =>
  trust.decision ?? (trust.trusted ? "trusted" : "declined");

export const isReviewScope = (status: TrustStatus) =>
  Predicate.isTagged(status.trust.scope, "ReviewCheckout");

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export interface TrustCopy {
  readonly title: string;
  readonly body: string;
  readonly caption: string;
  readonly trust: string;
}

export const trustCopy = (status: TrustStatus, workspace: string, host: string): TrustCopy => {
  const review = isReviewScope(status);
  const { typescriptVersion, plugins } = status.wouldRun;

  const parts = [
    typescriptVersion === null ? null : `TypeScript ${typescriptVersion}`,
    plugins.length === 0 ? null : plural(plugins.length, "tsconfig plugin"),
  ].filter(Predicate.isNotNull);

  const has = parts.length === 0 ? "its own TypeScript" : parts.join(" and ");
  const them = plugins.length === 0 ? "it" : "them";
  const subject = review ? "This review checkout" : "This workspace";

  return {
    title: review
      ? "Run this review checkout's own TypeScript?"
      : `Run ${workspace}'s own TypeScript?`,
    body: `${subject} has ${has}. Trusting it runs ${them} on ${host} as you, so errors match what tsc reports.`,
    caption: "Until then, the bundled TypeScript checks your code. Change this any time with ⇧⌘P.",
    trust: review ? "Trust review checkout" : `Trust ${workspace}`,
  };
};

/** Inline failure copy, chosen by the error's typed reason, never its message. */
export const trustFailure = (error: P.LanguageError, host: string) =>
  Match.value(error.reason).pipe(
    Match.when("conflict", () => `Trust changed on ${host} meanwhile. Try again.`),
    Match.when("not-connected", () => `Can't reach ${host}. Try again when it's back.`),
    Match.when("timeout", () => `No answer from ${host} in time. Try again.`),
    Match.when("cancelled", () => "Cancelled. Try again."),
    Match.orElse(() =>
      error.retryable
        ? `Couldn't change Trust on ${host}. Try again.`
        : `Couldn't change Trust on ${host}.`
    )
  );

/** What runs for a provider, as the language status says it (Paper L3): the Daemon's selection. */
export const providerName = (providerId: string, status: TrustStatus | null) => {
  if (providerId !== "typescript-language-server" || status === null) return providerId;

  const version = status.wouldRun.typescriptVersion;

  return status.provider === "project"
    ? `TypeScript${version === null ? "" : ` ${version}`}`
    : "TypeScript · bundled";
};
