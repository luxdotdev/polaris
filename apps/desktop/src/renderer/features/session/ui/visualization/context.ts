/** What a Visualization reads from its whole conversation, not its own call. */
import { createContext, useContext } from "react";

export interface VisualizationScope {
  /** Visualizations a later one replaced (`revisedIds`). */
  readonly revised: ReadonlySet<string>;
  /** "‹session title› · turn N" for a Visualization's id, for Expanded's bar. */
  readonly where: (id: string) => string | null;
}

export const noScope: VisualizationScope = { revised: new Set(), where: () => null };

export const VisualizationScopeContext = createContext<VisualizationScope>(noScope);

export const useVisualizationScope = () => useContext(VisualizationScopeContext);
