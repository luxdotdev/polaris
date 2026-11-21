import { readGroup, writeGroup } from "../settings/index.ts";
/**
 * Settings → Harnesses → Reviewer (ENG-222), kept on the Host because the
 * Daemon runs Reviews on its own: a default and per-Workspace overrides in
 * `~/.polaris/reviewer-settings.json`, resolved against what is installed.
 */
import { join } from "node:path";
import {
  AUTO_REVIEWERS,
  type HostHarnesses,
  ResolvedReviewer,
  ReviewerChoice,
  ReviewerSettings,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { polarisHome } from "../paths.ts";
import { ServiceError } from "../services.ts";

export const RULES_ONLY_NOTE =
  "Rules only: no Reviewer is available on this Host. Install or sign in to Claude Code or Codex.";

export const EMPTY_SETTINGS = ReviewerSettings.make({ default: null, workspaces: {} });

export const settingsPath = (): string => join(polarisHome(), "reviewer-settings.json");

export const loadSettings = (path: string) => Effect.sync(() => readGroup(path, "reviewer"));

export const saveSettings = (path: string, settings: ReviewerSettings) =>
  Effect.try({
    try: () => writeGroup(path, "reviewer", settings),
    catch: (cause) =>
      new ServiceError({
        service: "ReviewerSettings",
        message: "Could not save the reviewer settings",
        cause,
      }),
  });

const isReady = (harnesses: HostHarnesses, choice: ReviewerChoice): boolean =>
  harnesses.harnesses.some((h) => h.harness === choice.harness && h.status === "ready");

/** The Reviewer for `workspaceId` (or the Host default for null) given what is ready. */
export const resolveReviewer = (
  settings: ReviewerSettings,
  workspaceId: WorkspaceId | null,
  harnesses: HostHarnesses
): ResolvedReviewer => {
  const override = workspaceId === null ? undefined : settings.workspaces[workspaceId];

  if (override !== undefined) {
    return ResolvedReviewer.make({ choice: override, source: "workspace", note: null });
  }

  if (settings.default !== null) {
    return ResolvedReviewer.make({ choice: settings.default, source: "settings", note: null });
  }

  const auto = AUTO_REVIEWERS.find((choice) => isReady(harnesses, choice)) ?? null;

  return ResolvedReviewer.make({
    choice: auto,
    source: "auto",
    note: auto === null ? RULES_ONLY_NOTE : null,
  });
};
