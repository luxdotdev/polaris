/** The rename field and the symbol search: at most one of each, for one open file. */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface RenameField {
  readonly key: string;
  readonly initial: string;
  /** Viewport coordinates of the symbol's start, where the field anchors. */
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

interface NavigationState {
  readonly rename: RenameField | null;
  /** The file whose workspace symbols the search asks for. */
  readonly symbols: string | null;
}

export const navigationStore = createStore<NavigationState>(() => ({
  rename: null,
  symbols: null,
}));

export const openRename = (field: RenameField) => navigationStore.setState({ rename: field });

export const closeRename = () => navigationStore.setState({ rename: null });

export const openSymbolSearch = (key: string) => navigationStore.setState({ symbols: key });

export const closeSymbolSearch = () => navigationStore.setState({ symbols: null });

export const useRenameField = () => useStore(navigationStore, (state) => state.rename);

export const useSymbolSearch = () => useStore(navigationStore, (state) => state.symbols);
