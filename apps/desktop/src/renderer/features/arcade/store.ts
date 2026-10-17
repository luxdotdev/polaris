/** Which game the arcade card is showing, if any. */
import { createStore } from "zustand/vanilla";
import type { GameKind } from "./model/game.ts";

export const arcadeStore = createStore<{ readonly game: GameKind | null }>(() => ({ game: null }));

export const openGame = (game: GameKind) => arcadeStore.setState({ game });

export const closeGame = () => arcadeStore.setState({ game: null });
