/** A Harness's hue in the current theme; the unhued ones read in plain text. */
import type { HarnessKind } from "@polaris/protocol";
import type { MobileColours } from "../theme";

export const harnessHueIn = (colours: MobileColours, harness: HarnessKind): string => {
  if (harness === "claude") return colours.harnessClaudeCode;

  if (harness === "codex") return colours.harnessCodex;

  return harness === "opencode" ? colours.harnessOpencode : colours.textDefault;
};
