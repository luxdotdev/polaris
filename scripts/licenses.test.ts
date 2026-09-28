import { describe, expect, test } from "bun:test"
import { type Dependency, declaredLicense, isAllowed, judge } from "./licenses.ts"

describe("isAllowed", () => {
  test.each([
    ["MIT", true],
    ["Apache-2.0", true],
    ["(MIT OR GPL-3.0-only)", true],
    ["MIT AND BSD-3-Clause", true],
    ["MIT AND GPL-2.0-only", false],
    ["GPL-3.0-only", false],
    ["AGPL-3.0-or-later", false],
    ["Apache-2.0 WITH LLVM-exception", true],
    ["((MIT OR Apache-2.0) AND ISC)", true],
    ["SEE LICENSE IN README.md", false],
    ["UNLICENSED", false],
    ["", false],
    ["(MIT", false],
  ])("%s → %p", (expression, expected) => {
    expect(isAllowed(expression)).toBe(expected)
  })
})

describe("declaredLicense", () => {
  test("reads the string, object and legacy array forms", () => {
    expect(declaredLicense({ license: "MIT" })).toBe("MIT")
    expect(declaredLicense({ license: { type: "ISC" } })).toBe("ISC")
    expect(declaredLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe(
      "(MIT OR Apache-2.0)",
    )
    expect(declaredLicense({})).toBeNull()
  })
})

describe("judge", () => {
  const dep = (name: string, license: string | null): Dependency => ({
    name,
    version: "1.0.0",
    license,
    dir: "/nowhere",
    repository: null,
    requiredBy: new Set(["@polaris/daemon"]),
    platformBuilds: [],
  })

  test("matches prefix exceptions for per-platform builds", () => {
    const [verdict] = judge(
      [dep("@anthropic-ai/claude-agent-sdk-linux-x64", "SEE LICENSE IN LICENSE.md")],
      {
        "@anthropic-ai/claude-agent-sdk-*": { reason: "platform builds" },
      },
    )
    expect(verdict?.status).toBe("exception")
  })

  test("allows the allowlist, honours exceptions, and fails GPL and unknown licences", () => {
    const verdicts = judge(
      [
        dep("ok", "MIT"),
        dep("@anthropic-ai/claude-agent-sdk", "SEE LICENSE IN README.md"),
        dep("copyleft", "GPL-3.0-only"),
        dep("mystery", null),
      ],
      { "@anthropic-ai/claude-agent-sdk": { reason: "Anthropic terms" } },
    )
    expect(verdicts.map((v) => [v.dep.name, v.status])).toEqual([
      ["ok", "allowed"],
      ["@anthropic-ai/claude-agent-sdk", "exception"],
      ["copyleft", "violation"],
      ["mystery", "violation"],
    ])
  })
})
