/**
 * Instrument sheets (DESIGN.md, Mobile chrome redesign; Paper MX-H): bottom sheets with detents,
 * drawn above every screen by the `SheetHost` at the app's root.
 */
export { InstrumentSheet, SheetHost, type InstrumentSheetProps } from "./host.tsx";

export { type Detent } from "./detents.ts";

export {
  HeroWell,
  SheetHeader,
  SheetKicker,
  StatusFooter,
  StatusItem,
  Well,
  type SheetHeaderProps,
  type StatusFooterProps,
} from "./parts.tsx";

export { SheetDemo } from "./demo.tsx";
