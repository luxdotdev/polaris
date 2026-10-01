/**
 * The `/` menu for a composer: the Harness's Skills and Slash Commands where it
 * runs, and the Polaris actions some of them map to (DESIGN.md, Skills and
 * Slash Commands): a new session, the Model menu, Output, Settings → Usage.
 */
import type { HarnessKind, PolarisAction } from "@polaris/protocol";
import { useCommands } from "../../../shell/hooks.ts";
import { daemonNotice, useHarnessCommands } from "../../composer/index.ts";
import { callMachines, useMachineInstall } from "../../machines/index.ts";
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
  const listed = hasCapability(host, "harness.commands");
  // A connected Host whose Daemon predates the list: say so, never an empty menu.
  const outdated = host?.status.state === "connected" && !listed;
  const install = useMachineInstall(hostKey, outdated);
  const listing = useHarnessCommands(hostKey, harness, cwd, listed);

  const upgrade = () => void callMachines("machines.check", { hostKey });

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
    notice: outdated ? daemonNotice(host?.label ?? hostKey, install, upgrade) : null,
  };
};
