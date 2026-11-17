import { describe, expect, test } from "bun:test";
import { Actor, PersonId, ShareId } from "@polaris/protocol";
import { handedUpAttempts } from "../preview/graph.ts";
import { merged } from "./fold.ts";
import { approvedLine, reviewerNote } from "./reviewer.ts";

const maya = Actor.cases.Teammate.make({
  shareId: ShareId.make("share-maya"),
  personId: PersonId.make("person-maya"),
  name: "Maya Chen",
});

const b1 = () => {
  const attempt = handedUpAttempts().find((a) => a.taskId === "B1");

  if (attempt === undefined) throw new Error("B1 has a Claim in review");

  return attempt;
};

describe("who reviewed a Claim", () => {
  test("a Teammate's approval and send-back name them; the owner's read as before", () => {
    const approved = merged(b1(), { approvedByUserAt: "2026-11-16T12:00:00Z", reviewedBy: maya });
    const sentBack = merged(b1(), { state: "rejected", reviewedBy: maya });
    const owners = merged(b1(), { approvedByUserAt: "2026-11-16T12:00:00Z" });

    expect(approvedLine(approved)).toBe("approved by Maya Chen · the lead merges");
    expect(reviewerNote(approved)).toBe(" · approved by Maya Chen");
    expect(reviewerNote(sentBack)).toBe(" · by Maya Chen");
    expect(approvedLine(owners)).toBe("approved by you · the lead merges");
    expect(reviewerNote(owners)).toBeNull();
  });
});
