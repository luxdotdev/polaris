/** How Pierre lays out long lines: scrolled sideways, or wrapped under View → Word wrap. */
import { useSettings } from "../settings/index.ts";

export const useOverflow = (): "scroll" | "wrap" =>
  useSettings((s) => (s.appearance.wordWrap ? "wrap" : "scroll"));
