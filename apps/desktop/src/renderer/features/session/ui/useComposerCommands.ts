/**
 * The `/` menu for a composer: the Harness's Skills and Slash Commands where it
 * runs, and the Polaris actions some of them map to (DESIGN.md, Skills and
 * Slash Commands): a new session, the Model menu, Output, Settings → Usage.
 */
import type { HarnessKind, PolarisAction } from "@polaris/protocol";
import { useCommands } from "../../../shell/hooks.ts";
import { useHarnessCommands } from "../../composer/index.ts";
import { hasCapability, useHost } from "../hooks.ts";
import type { ComposerCommands } from "./DraftComposer.tsx";

export interface ComposerCommandsInput {
  readonly hostKey: string;
  /** Null until a Harness is chosen (the new-session page). */
  readonly harness: HarnessKind | null;
  readonly cwd: string | null;
  readonly openModels: () => void;
}

export const useComposerCommands = ({
  hostKey,
  harness,
  cwd,
  openModels,
}: ComposerCommandsInput): ComposerCommands => {
  const host = useHost(hostKey);
  const registry = useCommands();

  const listing = useHarnessCommands(
    hostKey,
    harness,
    cwd,
    hasCapability(host, "harness.commands")
  );

  const actions: Readonly<Record<PolarisAction, () => void>> = {
    "new-session": () => void registry.run("session.new"),
    model: openModels,
    diff: () => void registry.run("view.output"),
    usage: () => void registry.run("settings.usage"),
  };

  return {
    options: listing.options,
    loading: listing.loading,
    want: listing.want,
    onAction: (action) => actions[action](),
  };
};
