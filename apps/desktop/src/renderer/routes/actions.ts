/**
 * The shell's action registry: commands features offer to the K jump menu
 * ("Settings", "Settings: Appearance"…). A feature registers its actions once;
 * the jump menu lists them by group and runs the chosen one.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface ShellAction {
  /** Stable and unique, e.g. "settings.appearance". */
  readonly id: string;
  readonly title: string;
  /** The jump menu's group heading, e.g. "Settings". */
  readonly group: string;
  /** Extra words the jump menu matches on. */
  readonly keywords?: ReadonlyArray<string>;
  /** The key hint shown beside it, e.g. "⌘,". */
  readonly shortcut?: string;
  readonly run: () => void;
}

const registry = createStore<ReadonlyArray<ShellAction>>(() => []);

/** Adds actions (replacing any with the same id); returns their removal. */
export const registerActions = (actions: ReadonlyArray<ShellAction>): (() => void) => {
  const ids = new Set(actions.map((a) => a.id));

  registry.setState((current) => [...current.filter((a) => !ids.has(a.id)), ...actions], true);

  return () => registry.setState((current) => current.filter((a) => !ids.has(a.id)), true);
};

export const registeredActions = (): ReadonlyArray<ShellAction> => registry.getState();

export const useRegisteredActions = (): ReadonlyArray<ShellAction> => useStore(registry);
