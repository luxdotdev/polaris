/**
 * Each session's agent-browser config, `{ "cdp": <relay URL> }` in a 0600 file: the URL reaches
 * agent-browser without argv or an env var that the agent's commands would inherit.
 */
import type { SessionId } from "@polaris/protocol";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, type Scope } from "effect";

/** Held while any open of the session needs it; the last release removes the file. */
export const sessionConfigs = (dir: string) => {
  const holders = new Map<SessionId, number>();
  const pathOf = (sessionId: SessionId) => join(dir, `${encodeURIComponent(sessionId)}.json`);

  const write = async (sessionId: SessionId, cdpUrl: string) => {
    const path = pathOf(sessionId);
    const staging = `${path}.${process.pid}.tmp`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(staging, `${JSON.stringify({ cdp: cdpUrl })}\n`, { mode: 0o600 });
    await rename(staging, path);

    return path;
  };

  const release = (sessionId: SessionId) =>
    Effect.promise(async () => {
      const left = (holders.get(sessionId) ?? 1) - 1;

      if (left > 0) return void holders.set(sessionId, left);
      holders.delete(sessionId);
      await rm(pathOf(sessionId), { force: true });
    });

  return (sessionId: SessionId, cdpUrl: string): Effect.Effect<string, unknown, Scope.Scope> =>
    Effect.acquireRelease(
      Effect.tryPromise(async () => {
        const path = await write(sessionId, cdpUrl);
        holders.set(sessionId, (holders.get(sessionId) ?? 0) + 1);

        return path;
      }),
      () => release(sessionId)
    );
};
