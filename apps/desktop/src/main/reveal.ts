/** What "Show in Finder" (Explorer) selects for the running app, from its executable's path. */
import { dirname, join } from "node:path";
import type { ClientPlatform } from "../shared/platform.ts";

/** Windows: Polaris.exe in its install folder; elsewhere the bundle, from `.app/Contents/MacOS`. */
export const appRevealPath = (platform: ClientPlatform, exe: string): string =>
  platform === "win32" ? exe : join(dirname(exe), "../..");
