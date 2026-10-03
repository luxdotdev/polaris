import { Match, Predicate } from "effect";
import type { LanguageHostView, LanguageSettingsAction, LanguageToolView } from "./contracts.ts";

export const installationText = (tool: LanguageToolView) =>
  Match.value(tool.availability.installation).pipe(
    Match.tag("NotInstalled", () => "Not installed"),
    Match.tag("Installing", (value) => `Installing ${value.version}`),
    Match.tag("Installed", (value) => `Installed ${value.version}`),
    Match.tag(
      "Failed",
      (value) =>
        `Installation failed: ${value.message}${value.retainedVersion ? ` · retained ${value.retainedVersion}` : ""}`
    ),
    Match.exhaustive
  );

export const runtimeText = (tool: LanguageToolView) =>
  tool.runtime === null
    ? "Runtime not observed"
    : Match.value(tool.runtime).pipe(
        Match.tag("AwaitingTrust", () => "Awaiting trust"),
        Match.tag("Starting", () => "Starting"),
        Match.tag(
          "Ready",
          (value) => `Running · ${value.capabilities.methods.length} supported methods`
        ),
        Match.tag("Stopped", (value) => `Stopped · ${value.reason}`),
        Match.tag("Failed", (value) => `Failed · ${value.message} · ${value.attempts} attempts`),
        Match.tag("Unsupported", (value) => `Unsupported · ${value.message}`),
        Match.exhaustive
      );

export const toolAction = (
  host: LanguageHostView,
  tool: LanguageToolView
): { label: string; action: LanguageSettingsAction } | null => {
  if (
    host.connection !== "Connected" ||
    host.capability !== "available" ||
    host.id !== tool.availability.hostId
  )
    return null;
  const a = tool.actions;
  const base = { hostKey: host.key, toolId: tool.availability.toolId };

  if (
    a.cancel &&
    Predicate.isTagged(tool.availability.installation, "Installing") &&
    a.cancel === tool.availability.installation.jobId
  )
    return {
      label: "Cancel installation",
      action: { kind: "cancel-install", hostKey: host.key, jobId: a.cancel },
    };

  if (!Predicate.isTagged(tool.availability.preflight, "Eligible")) return null;

  if (a.retry && Predicate.isTagged(tool.availability.installation, "Failed"))
    return { label: "Retry", action: { kind: "retry", ...base, version: a.retry } };

  if (a.install && Predicate.isTagged(tool.availability.installation, "NotInstalled"))
    return {
      label: "Install",
      action: { kind: "install", ...base, version: a.install, intent: "manual" },
    };

  if (a.update && tool.availability.updateCandidate === a.update)
    return {
      label: "Update",
      action: { kind: "install", ...base, version: a.update, intent: "update" },
    };

  if (
    a.restart &&
    a.restart.hostId === host.id &&
    tool.runtime !== null &&
    !Predicate.isTagged(tool.runtime, "AwaitingTrust") &&
    !Predicate.isTagged(tool.runtime, "Starting") &&
    !Predicate.isTagged(tool.runtime, "Unsupported")
  )
    return { label: "Restart", action: { kind: "restart", hostKey: host.key, context: a.restart } };

  return null;
};

export const trustFacts = (host: LanguageHostView) => {
  const trust = host.trust ?? host.discovery?.trust;
  const checkout = host.trustCheckout ?? host.discovery?.checkout;

  return trust !== undefined && checkout !== undefined ? { trust, checkout } : null;
};

/** Worktrees target Workspace trust; Review Checkout grants must match the exact checkout. */
export const trustMatchesCheckout = (host: LanguageHostView): boolean => {
  const d = trustFacts(host);

  if (
    !d ||
    d.trust.scope.hostId !== host.id ||
    d.trust.scope.workspaceId !== d.checkout.workspaceId
  )
    return false;

  return Match.value(d.checkout).pipe(
    Match.tag("Workspace", "Worktree", () => Predicate.isTagged(d.trust.scope, "Workspace")),
    Match.tag("ReviewCheckout", (checkout) =>
      Match.value(d.trust.scope).pipe(
        Match.tag(
          "ReviewCheckout",
          (scope) => scope.reviewCheckoutId === checkout.reviewCheckoutId
        ),
        Match.orElse(() => false)
      )
    ),
    Match.exhaustive
  );
};
