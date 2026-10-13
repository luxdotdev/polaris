/**
 * Which of the header's popovers is open: Reviewers or Merge. A store, so the palette's
 * "Merge #88…" and "Request reviewers on #88…" can open them.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type Panel = "reviewers" | "merge";

export const panelStore = createStore<{ readonly open: Panel | null }>(() => ({ open: null }));

export const useOpenPanel = (): Panel | null => useStore(panelStore, (s) => s.open);

export const openPanel = (panel: Panel) => panelStore.setState({ open: panel });

export const setPanelOpen = (panel: Panel, open: boolean) =>
  panelStore.setState((s) => ({ open: open ? panel : s.open === panel ? null : s.open }));
