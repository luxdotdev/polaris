/**
 * `polaris selftest`: checks that this build's native pieces work on this
 * Host. Today that is fff's library, which `bun build --compile` embeds
 * (see scripts/build-daemon.ts); without it, file search silently falls back
 * to git. The build and CI run this against every binary they can execute.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fffLoadError, makeFffBackend } from "../files/search/fff.ts"
import { versionLine } from "./platform.ts"

export interface SelfTestResult {
  readonly ok: boolean
  readonly lines: ReadonlyArray<string>
}

export const selfTest = async (): Promise<SelfTestResult> => {
  const scratch = mkdtempSync(join(tmpdir(), "polaris-selftest-"))
  const previousHome = process.env.POLARIS_HOME
  process.env.POLARIS_HOME = join(scratch, "home")
  try {
    const root = join(scratch, "root")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "polaris-selftest-needle.txt"), "needle\n")
    const backend = await makeFffBackend(root)
    if (backend === null) {
      return {
        ok: false,
        lines: [versionLine(), `fff: unavailable (${fffLoadError() ?? "unknown"})`],
      }
    }
    try {
      const hits = await backend.searchPaths("selftestneedle", 5)
      const found = hits.some((hit) => hit.path.endsWith("polaris-selftest-needle.txt"))
      return {
        ok: found,
        lines: [versionLine(), found ? "fff: ok" : `fff: loaded but search found nothing`],
      }
    } finally {
      backend.dispose()
    }
  } finally {
    if (previousHome === undefined) delete process.env.POLARIS_HOME
    else process.env.POLARIS_HOME = previousHome
    rmSync(scratch, { recursive: true, force: true })
  }
}
