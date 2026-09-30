/**
 * Stops the detached Codex app-server a throwaway Daemon started under
 * `<POLARIS_HOME>` (see `src/harness/codex/AppServer.ts`); used by test harnesses
 * that run under Node. Only the recorded server whose command line still names
 * this home's socket is signalled, so no other app-server is touched.
 *
 *   bun apps/daemon/scripts/stop-codex-app-server.ts <POLARIS_HOME>
 */
import { join } from "node:path";
import { Effect } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

const home = process.argv[2];

if (home === undefined) {
  console.error("usage: stop-codex-app-server.ts <POLARIS_HOME>");
  process.exit(2);
}

const socketPath = join(home, "codex.sock");

const { stopped } = await Effect.runPromise(
  stopAppServer({ stateFile: defaultStateFile(socketPath), socketPath })
);

if (stopped !== null) console.log(`stopped codex app-server ${stopped}`);
