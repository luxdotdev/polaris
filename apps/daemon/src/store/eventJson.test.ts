import { expect, test } from "bun:test";
import { DomainEvent, SessionId } from "@polaris/protocol";
import { Schema } from "effect";
import { EventJson } from "./eventJson.ts";
import { CID, draft, report, task } from "../engine/constellation.testing.ts";

const canonical = Schema.toCodecJson(DomainEvent);

const encode = Schema.encodeSync(canonical);

const decode = Schema.decodeUnknownSync(canonical);

const examples = [
  DomainEvent.cases.SessionRenamed.make({ sessionId: SessionId.make("s"), title: "Renamed" }),
  DomainEvent.cases.TaskProposed.make({
    constellationId: CID,
    revision: 1,
    proposalId: "p",
    by: draft().id,
    task: task(),
  }),
  DomainEvent.cases.AttemptStarted.make({ constellationId: CID, revision: 2, attempt: draft() }),
  DomainEvent.cases.AttemptClaimed.make({
    constellationId: CID,
    revision: 3,
    attemptId: draft().id,
    attemptRevision: 1,
    claim: report(),
  }),
];

test("per-kind codecs preserve the canonical event encoding and constructor defaults", () => {
  for (const event of examples) {
    const text = JSON.stringify(encode(event));
    expect(EventJson.encode(event)).toBe(text);
    expect(EventJson.decode(text)).toEqual(decode(JSON.parse(text)));
  }

  const legacy =
    '{"_tag":"TaskProposed","constellationId":"c1","revision":2,"proposalId":"defaults","by":"a1","task":{"id":"A","title":"Defaults","brief":"Brief","kind":"task"}}';

  expect(EventJson.decode(legacy)).toEqual(decode(JSON.parse(legacy)));
});

test("per-kind decoding rejects unknown tags and malformed nested payloads before folding", () => {
  for (const text of [
    "null",
    "{}",
    '{"_tag":"Unknown"}',
    '{"_tag":"AttemptStarted","constellationId":"c1","revision":1,"attempt":{}}',
    '{"_tag":"AttemptClaimed","constellationId":"c1","revision":1,"attemptId":"a1","attemptRevision":1,"claim":{"head":1}}',
  ]) {
    expect(() => EventJson.decode(text)).toThrow();
  }
});
