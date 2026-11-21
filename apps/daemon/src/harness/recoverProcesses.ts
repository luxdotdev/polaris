import { existsSync } from "node:fs";
import { join } from "node:path";

/** A surviving Codex server must be registered before any local Client can acquire user authority. */
export const recoverHarnessProcesses = async (root: string): Promise<() => void> => {
  const stateFile = join(root, "codex-app-server.json");

  if (process.platform === "win32" || !existsSync(stateFile)) return () => {};

  const { registerExistingAppServer } = await import("./codex/AppServer.ts");

  return registerExistingAppServer(stateFile);
};
