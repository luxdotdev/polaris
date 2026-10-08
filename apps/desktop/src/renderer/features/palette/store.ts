/**
 * The palette's own state: Recent (persisted) and the follow-up a "…" command
 * is asking. Whether the palette is open is the shell's (`setPaletteOpen`), since
 * it is one of the shell's overlays.
 */
import { createStore } from "zustand/vanilla";
import type { CommandRegistry, FollowUp } from "../../routes/commands.ts";
import type { ShellActions } from "../../routes/navigation.ts";
import { loadRecents, type RecentsStorage, saveRecents, withRecent } from "./model/recents.ts";

interface PaletteState {
  readonly recent: ReadonlyArray<string>;
  readonly followUp: FollowUp | null;
}

export const paletteStore = createStore<PaletteState>(() => ({ recent: [], followUp: null }));

let storage: RecentsStorage | null = null;

export const recordRecent = (id: string) => {
  const recent = withRecent(paletteStore.getState().recent, id);

  paletteStore.setState({ recent });
  saveRecents(storage, recent);
};

export const clearFollowUp = () => paletteStore.setState({ followUp: null });

/** Swaps in a loading follow-up's answer, unless the palette moved on meanwhile. */
export const loadFollowUp = async (followUp: FollowUp) => {
  if (followUp.load === undefined) return;
  const next = await followUp.load();

  if (paletteStore.getState().followUp === followUp) paletteStore.setState({ followUp: next });
};

export interface InstallInput {
  readonly commands: CommandRegistry;
  readonly actions: Pick<ShellActions, "setPaletteOpen">;
  readonly storage: RecentsStorage | null;
}

/** Loads Recent and routes every follow-up into the palette, opening it if a shortcut asked. */
export const installPalette = ({ commands, actions, storage: kept }: InstallInput) => {
  storage = kept;
  paletteStore.setState({ recent: loadRecents(kept) });

  return commands.onFollowUp((followUp) => {
    paletteStore.setState({ followUp });
    actions.setPaletteOpen(true);
    void loadFollowUp(followUp);
  });
};
