/**
 * Compatibility of the persisted and streamed contract: events already in a
 * Host's log must keep decoding, and additions must be additive.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { ApprovalDecision, TurnItem } from "./domain.ts";
import { DomainEvent } from "./events.ts";
import { RequestId, Sequence, SessionId, TurnId } from "./ids.ts";
import { SessionStreamItem, TerminalLaunch } from "./rpc.ts";

const decodeEvent = Schema.decodeUnknownSync(Schema.toCodecJson(DomainEvent));

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(DomainEvent));

/** Decodes a log row or wire message exactly as it was written, as JSON text. */
const decodeEventJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(DomainEvent))
);

const decodeItemJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(SessionStreamItem))
);

describe("contract compatibility", () => {
  test("a withdrawal logged before ApprovalWithdrawn existed still decodes", () => {
    const legacy =
      '{"_tag":"ApprovalResolved","sessionId":"s","requestId":"r",' +
      '"decision":{"_tag":"Deny","reason":"Withdrawn by the Harness"},"resolvedBy":"Harness"}';

    expect(decodeEventJson(legacy)).toEqual(
      DomainEvent.cases.ApprovalResolved.make({
        sessionId: SessionId.make("s"),
        requestId: RequestId.make("r"),
        decision: ApprovalDecision.cases.Deny.make({ reason: "Withdrawn by the Harness" }),
        resolvedBy: "Harness",
      })
    );
  });

  test("ApprovalWithdrawn round-trips", () => {
    const event = DomainEvent.cases.ApprovalWithdrawn.make({
      sessionId: SessionId.make("s"),
      requestId: RequestId.make("r"),
      withdrawnBy: "daemon",
      reason: "The Daemon restarted",
    });

    expect(decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))).toEqual(event);
  });

  test("ItemProgress carries a full item; a Snapshot with unknown extra fields still decodes", () => {
    expect(
      decodeItemJson(
        '{"_tag":"ItemProgress","turnId":"t",' +
          '"item":{"_tag":"Plan","id":"p","steps":[{"text":"a","status":"in-progress"}]}}'
      )
    ).toEqual(
      SessionStreamItem.cases.ItemProgress.make({
        turnId: TurnId.make("t"),
        item: TurnItem.cases.Plan.make({ id: "p", steps: [{ text: "a", status: "in-progress" }] }),
      })
    );
    expect(decodeItemJson('{"_tag":"Synchronized","sequence":3,"somethingNewer":true}')).toEqual(
      SessionStreamItem.cases.Synchronized.make({ sequence: Sequence.make(3) })
    );
  });

  test("TerminalLaunch", () => {
    const decode = Schema.decodeUnknownSync(TerminalLaunch);
    expect(decode({ argv: ["claude", "--resume", "x"], cwd: "/repo", env: {} })).toBeInstanceOf(
      TerminalLaunch
    );
  });
});
