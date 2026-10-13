/**
 * Windows' terminal copy and paste keys (Ctrl+Shift+C/V, Ctrl+Insert, Shift+Insert), since
 * Ctrl+C there stays the interrupt. macOS and Linux keep ⌘C/⌘V through the Edit menu.
 */
import type { ClientPlatform } from "../../../shared/platform.ts";

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export const clipboardKey = (event: KeyLike, platform: ClientPlatform): "copy" | "paste" | null => {
  if (platform !== "win32" || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();

  if (key === "insert" && event.ctrlKey !== event.shiftKey) {
    return event.ctrlKey ? "copy" : "paste";
  }

  if (!event.ctrlKey || !event.shiftKey) return null;

  if (key === "c") return "copy";

  return key === "v" ? "paste" : null;
};
