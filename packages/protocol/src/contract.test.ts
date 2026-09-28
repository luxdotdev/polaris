/**
 * Compatibility of the persisted and streamed contract: events already in a
 * Host's log must keep decoding, and additions must be additive.
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { DomainEvent } from "./events.ts"
import { SessionStreamItem, TerminalLaunch } from "./rpc.ts"

const decodeEvent = Schema.decodeUnknownSync(Schema.toCodecJson(DomainEvent))
const encodeEvent = Schema.encodeSync(Schema.toCodecJson(DomainEvent))
const decodeItem = Schema.decodeUnknownSync(Schema.toCodecJson(SessionStreamItem))

describe("contract compatibility", () => {
  test("a withdrawal logged before ApprovalWithdrawn existed still decodes", () => {
    const legacy = {
      _tag: "ApprovalResolved",
      sessionId: "s",
      requestId: "r",
      decision: { _tag: "Deny", reason: "Withdrawn by the Harness" },
      resolvedBy: "Harness",
    }
    expect(decodeEvent(legacy)).toMatchObject({ _tag: "ApprovalResolved", resolvedBy: "Harness" })
  })

  test("ApprovalWithdrawn round-trips", () => {
    const event = DomainEvent.cases.ApprovalWithdrawn.make({
      sessionId: "s" as never,
      requestId: "r" as never,
      withdrawnBy: "daemon",
      reason: "The Daemon restarted",
    })
    expect(decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))).toEqual(event)
  })

  test("ItemProgress carries a full item; a Snapshot with unknown extra fields still decodes", () => {
    expect(
      decodeItem({
        _tag: "ItemProgress",
        turnId: "t",
        item: { _tag: "Plan", id: "p", steps: [{ text: "a", status: "in-progress" }] },
      }),
    ).toMatchObject({ _tag: "ItemProgress", item: { _tag: "Plan" } })
    expect(
      decodeItem({
        _tag: "Synchronized",
        sequence: 3,
        somethingNewer: true,
      }),
    ).toEqual({ _tag: "Synchronized", sequence: 3 as never })
  })

  test("TerminalLaunch", () => {
    const decode = Schema.decodeUnknownSync(TerminalLaunch)
    expect(decode({ argv: ["claude", "--resume", "x"], cwd: "/repo", env: {} })).toBeInstanceOf(
      TerminalLaunch,
    )
  })
})
