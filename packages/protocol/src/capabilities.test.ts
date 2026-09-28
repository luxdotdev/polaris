import { expect, test } from "bun:test"
import { Schema } from "effect"
import { CapabilityList } from "./capabilities.ts"

test("unknown capability names are dropped, not rejected", () => {
  const decode = Schema.decodeUnknownSync(CapabilityList)
  expect(decode(["files.read", "session.from-the-future", "terminal"])).toEqual([
    "files.read",
    "terminal",
  ])
})
