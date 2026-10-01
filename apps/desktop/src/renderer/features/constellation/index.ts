/**
 * Constellations in the Desktop App: the read model (folded from the Host feed), the tab in a
 * Lead's Output, the focus swap, and what other features share (hooks, glyphs, actions).
 */
export { ConstellationIntent, ConstellationOutput } from "./ui/slots.tsx";

export { ConstellationTab } from "./ui/ConstellationTab.tsx";

export { ConstellationMark, TaskGlyph, type TaskGlyphProps } from "./ui/glyphs.tsx";

export {
  type FocusTarget,
  useConstellationActions,
  useConstellations,
  useFacts,
  useFocusedTask,
  useLeadConstellation,
  useWorkerAttempt,
  type WorkerAttempt,
} from "./hooks.ts";

export {
  type ConstellationClient,
  constellationCommands,
  installConstellationClient,
} from "./client.ts";

export { setSignals, type Signals } from "./state.ts";

export {
  applyConstellationHostItems,
  applyStreamItems,
  type ConstellationRecord,
  type ConstellationsModel,
  type ConstellationView,
  emptyConstellations,
  glyphFor,
  type TaskGlyphKind,
} from "./model/index.ts";
