import { describe, expect, test } from "bun:test"
import { compare, countViolations, tighten } from "./baseline.ts"
import { ruleName } from "./oxlint.ts"

const at = (file: string, rule: string) => ({ file, rule, line: 1, column: 1, message: "" })

describe("lint baseline", () => {
  test("counts violations per file and rule", () => {
    const counts = countViolations([at("b.ts", "x"), at("a.ts", "y"), at("a.ts", "y")])

    expect(counts).toEqual({ "a.ts": { y: 2 }, "b.ts": { x: 1 } })
  })

  test("a new file, a new rule or a higher count is a regression", () => {
    const baseline = { "a.ts": { y: 2 } }
    const current = { "a.ts": { y: 3, z: 1 }, "new.ts": { y: 1 } }

    const { regressions } = compare(baseline, current, null)

    expect(regressions.map((d) => [d.file, d.rule, d.baseline, d.current])).toEqual([
      ["a.ts", "y", 2, 3],
      ["a.ts", "z", 0, 1],
      ["new.ts", "y", 0, 1],
    ])
  })

  test("only files in scope are compared", () => {
    const { regressions, improvements } = compare(
      { "a.ts": { y: 2 }, "b.ts": { y: 1 } },
      { "a.ts": { y: 1 } },
      new Set(["a.ts"]),
    )

    expect(regressions).toEqual([])
    expect(improvements.map((d) => d.file)).toEqual(["a.ts"])
  })

  test("tightening lowers counts, drops fixed entries and never loosens", () => {
    const baseline = { "a.ts": { y: 2, z: 1 }, "gone.ts": { y: 4 } }
    const current = { "a.ts": { y: 1, z: 5 }, "new.ts": { y: 1 } }

    expect(tighten(baseline, current, null)).toEqual({ "a.ts": { y: 1, z: 1 } })
  })

  test("tightening leaves files outside the scope alone", () => {
    const baseline = { "a.ts": { y: 2 }, "b.ts": { y: 2 } }

    expect(tighten(baseline, {}, new Set(["a.ts"]))).toEqual({ "b.ts": { y: 2 } })
  })

  test("rule names read as plugin/rule", () => {
    expect(ruleName("anti-slop(no-object-parameters)")).toBe("anti-slop/no-object-parameters")
    expect(ruleName("eslint(max-lines)")).toBe("max-lines")
    expect(ruleName(undefined)).toBe("oxlint/diagnostic")
  })
})
