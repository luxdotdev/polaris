/**
 * The `/` menu for a composer: the Harness's Skills and Slash Commands where it
 * runs, and the Polaris actions some of them map to (DESIGN.md, Skills and
 * Slash Commands): a new session, the Model menu, Output, Settings → Usage.
 */
import type { HarnessKind, PolarisAction } from "@polaris/protocol";
import { useCommands } from "../../../shell/hooks.ts";
import { useState } from "react";
import {
  daemonNotice,
  frecencyKey,
  type FrecencyTable,
  loadFrecency,
  recordFrecency,
  scopeKey,
  useHarnessCommands,
} from "../../composer/index.ts";
// The machines feed alone: the feature's index reaches slots.tsx, an import cycle from here.
import { useMachineInstall } from "../../machines/hooks.tsx";
import { hasCapability, useHost } from "../hooks.ts";
import type { ComposerCommands } from "./DraftComposer.tsx";

/**
 * Runs once the key or pointer that picked the command is released: a menu
 * opened on ↵'s keydown would otherwise take its keyup and pick its first item.
 */
const afterRelease = (run: () => void) => {
  const done = () => {
    window.removeEventListener("keyup", done, true);
    window.removeEventListener("pointerup", done, true);
    requestAnimationFrame(run);
  };

  window.addEventListener("keyup", done, { capture: true, once: true });
  window.addEventListener("pointerup", done, { capture: true, once: true });
};

export interface ComposerCommandsInput {
  readonly hostKey: string;
  /** Frecency is kept per Host, Workspace and Harness. */
  readonly workspaceId: string;
  /** Null until a Harness is chosen (the new-session page). */
  readonly harness: HarnessKind | null;
  readonly cwd: string | null;
  readonly openModels: () => void;
}

export const useComposerCommands = ({
  hostKey,
  workspaceId,
  harness,
  cwd,
  openModels,
}: ComposerCommandsInput): ComposerCommands => {
  const scope = { hostKey, workspaceId, harness: harness ?? "" };
  const scopeId = scopeKey(scope);

  const [picked, setPicked] = useState<{
    readonly id: string;
    readonly table: FrecencyTable;
  } | null>(null);
  // Read from storage until this composer records a pick of its own.

  const frecency = picked?.id === scopeId ? picked.table : loadFrecency(scope);
  const host = useHost(hostKey);
  const registry = useCommands();
  const listed = hasCapability(host, "harness.commands");
  // A connected Host whose Daemon predates the list: say so, never an empty menu.
  const outdated = host?.status.state === "connected" && !listed;
  const install = useMachineInstall(hostKey, outdated);
  const listing = useHarnessCommands(hostKey, harness, cwd, listed);

  const openHosts = () => void registry.run("settings.hosts");

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
    onAction: (action) => afterRelease(actions[action]),
    notice: outdated ? daemonNotice(host?.label ?? hostKey, install, openHosts) : null,
    frecency,
    onPicked: (option) => {
      if (harness !== null)
        setPicked({ id: scopeId, table: recordFrecency(scope, frecencyKey(option)) });
    },
  };
};
