/**
 * `polaris bridge` with a shorter wait for the fallback supervisor, for
 * bridge.test.ts. Runs as its own process: under `bun test`, a failed
 * `node:net` connect to a Unix socket fails the test even when handled.
 *
 *   POLARIS_HOME=<dir> bun bridge.ts <waitMs>
 */
import { runBridge } from "../bridge.ts"

process.exit(await runBridge({ waitMs: Number(process.argv[2] ?? 5000) }))
