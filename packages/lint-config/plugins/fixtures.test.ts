import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Schema } from "effect"

const OXLINT = join(import.meta.dir, "../../../node_modules/.bin/oxlint")

const Report = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String, filename: Schema.String })),
})

/** Runs oxlint on one plugin's fixtures with that plugin's fixture config. */
function lintFixtures(plugin: string) {
  const dir = join(import.meta.dir, plugin, "test")

  const run = Bun.spawnSync(
    [OXLINT, "-c", "fixtures.oxlintrc.json", "--format", "json", "fixtures"],
    { cwd: dir },
  )

  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Report))(run.stdout.toString())

  return report.diagnostics
}

describe("custom oxlint plugins", () => {
  test("polaris/no-long-comment reports each over-long group once", () => {
    const diagnostics = lintFixtures("polaris")

    expect(diagnostics.filter((d) => !d.filename.endsWith("long-comment.ts"))).toEqual([])
    expect(diagnostics.filter((d) => d.filename.endsWith("long-comment.ts"))).toHaveLength(4)
    expect(new Set(diagnostics.map((d) => d.code))).toEqual(new Set(["polaris(no-long-comment)"]))
  })

  test("sonarjs/cognitive-complexity reports only the tangled function", () => {
    const diagnostics = lintFixtures("sonarjs")

    expect(diagnostics.map((d) => [d.code, d.filename])).toEqual([
      ["sonarjs(cognitive-complexity)", "fixtures/complex.ts"],
    ])
  })
})
