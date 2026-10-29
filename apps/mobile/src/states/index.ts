/**
 * The empty, offline and error states (DESIGN.md, Mobile chrome redesign · phase 3; Paper MX-AV):
 * one pattern. A top-level screen shows a `StatePanel`; inside a thread nothing becomes a banner.
 */
export {
  StatePanel,
  STATE_HORIZON_TOP,
  type StateAction,
  type StatePanelProps,
} from "./StatePanel.tsx";

export {
  BubbleFootnote,
  type BubbleState,
  ReconnectingLine,
  type ReconnectingLineProps,
  useBubbleTreatment,
} from "./thread.tsx";

export { StatesGallery, statesGalleryOn } from "./Gallery.tsx";
