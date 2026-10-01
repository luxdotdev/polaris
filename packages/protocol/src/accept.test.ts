import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AcceptBranch,
  AcceptCommitted,
  AcceptDraft,
  AcceptPlan,
  AcceptRefused,
  AcceptRemote,
  AcceptTurn,
} from "./accept.ts";
import { SessionId, TurnId } from "./ids.ts";
import { CommitAccepted, DaemonRpcs } from "./rpc.ts";

const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A) => {
  const codec = Schema.toCodecJson(schema);
  const json = JSON.stringify(Schema.encodeSync(codec)(value));

  return Schema.decodeUnknownSync(codec)(JSON.parse(json));
};

describe("accepting a session's work", () => {
  test("the plan, draft and commit round-trip", () => {
    const plan = new AcceptPlan({
      sessionId: SessionId.make("s1"),
      root: "/repo",
      turns: [new AcceptTurn({ turnId: TurnId.make("t1"), index: 0, title: "Fix it", files: 2 })],
      laterTurns: 1,
      branch: null,
      defaultBranch: "main",
      worktree: false,
      remote: new AcceptRemote({ name: "origin", url: "git@github.com:a/b.git" }),
      files: 2,
      additions: 3,
      deletions: 1,
    });

    const draft = new AcceptDraft({
      title: "Fix it",
      body: "",
      prTitle: "Fix it",
      prBody: "",
      turnTitles: ["Fix it"],
      source: "template",
      note: "the agent didn't answer",
    });

    const committed = new AcceptCommitted({ branch: "polaris/x", commits: ["abc"], base: "main" });

    expect(roundTrip(AcceptPlan, plan)).toEqual(plan);
    expect(roundTrip(AcceptDraft, draft)).toEqual(draft);
    expect(roundTrip(AcceptCommitted, committed)).toEqual(committed);
    expect(roundTrip(AcceptRefused, new AcceptRefused({ reason: "no" })).reason).toBe("no");
  });

  test("the commit request names its branch as Current or Create", () => {
    const payload = CommitAccepted.payloadSchema;

    const create = {
      sessionId: SessionId.make("s1"),
      throughTurnId: TurnId.make("t1"),
      branch: AcceptBranch.cases.Create.make({ name: "polaris/x" }),
      granularity: "per-turn" as const,
      title: "Fix it",
      body: "",
      turnTitles: ["Fix it"],
    };

    expect(roundTrip(payload, create)).toEqual(create);
    expect(DaemonRpcs.requests.has("session.commitAccepted")).toBe(true);
    expect(DaemonRpcs.requests.has("session.pushAccepted")).toBe(true);
  });
});
