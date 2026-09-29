/**
 * Compatibility of the persisted and streamed contract: events already in a
 * Host's log must keep decoding, and additions must be additive.
 */
import { describe, expect, test } from "bun:test";
import { Predicate, Schema } from "effect";
import { HarnessAvailability, HostHarnesses } from "./availability.ts";
import { CapabilityList } from "./capabilities.ts";
import { Command } from "./commands.ts";
import { ApprovalDecision, Subagent, TurnItem } from "./domain.ts";
import { DomainEvent } from "./events.ts";
import { HARNESS_CATALOGUE, harnessEntry } from "./harnesses.ts";
import { RequestId, Sequence, SessionId, SubagentId, TurnId } from "./ids.ts";
import { Model } from "./models.ts";
import { HarnessModels, SessionStreamItem, TerminalLaunch, TurnDetail } from "./rpc.ts";
import { PlanLimit, ReportedCost, TokenCounts, UsageBucket, UsageStreamItem } from "./usage.ts";

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
        subagentId: null,
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

  const legacySession =
    '{"id":"s","workspaceId":"w","harness":"claude","title":"t","cwd":"/repo","worktreeId":null,' +
    '"state":"idle","permissionMode":"supervised","model":"opus","parentSessionId":null,' +
    '"forkedFromTurnId":null,"harnessCursor":null,"turnCount":1,"lastError":null,' +
    '"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}';

  const legacyTurn =
    '{"id":"t","sessionId":"s","index":0,"prompt":"hi","attachments":[],"status":"completed",' +
    '"checkpointBefore":null,"checkpointAfter":null,' +
    '"startedAt":"2026-01-01T00:00:00Z","endedAt":"2026-01-01T00:01:00Z"}';

  test("sessions and Turns logged before Model per Turn decode with no effort and no Model", () => {
    const created = decodeEventJson(`{"_tag":"SessionCreated","session":${legacySession}}`);
    const started = decodeEventJson(`{"_tag":"TurnStarted","turn":${legacyTurn}}`);

    expect(Predicate.isTagged(created, "SessionCreated") && created.session).toMatchObject({
      model: "opus",
      effort: null,
    });
    expect(Predicate.isTagged(started, "TurnStarted") && started.turn).toMatchObject({
      model: null,
      effort: null,
    });
  });

  test("a session of a Harness this build doesn't list still decodes", () => {
    const newer = legacySession.replace('"harness":"claude"', '"harness":"opencode"');
    const event = decodeEventJson(`{"_tag":"SessionCreated","session":${newer}}`);

    expect(Predicate.isTagged(event, "SessionCreated") && event.session.harness).toBe("opencode");
    expect(harnessEntry("opencode")).toBeUndefined();
    expect(() =>
      decodeEventJson(
        `{"_tag":"SessionCreated","session":${legacySession.replace('"claude"', '"Not A Kind"')}}`
      )
    ).toThrow();
  });

  test("SessionModelChanged round-trips", () => {
    const event = DomainEvent.cases.SessionModelChanged.make({
      sessionId: SessionId.make("s"),
      model: "gpt-5.5",
      effort: "high",
    });

    expect(decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))).toEqual(event);
  });

  test("commands from Clients that predate effort still decode", () => {
    const decodeCommand = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(Command))
    );

    const start = decodeCommand(
      '{"_tag":"StartSession","sessionId":"s","workspaceId":"w","harness":"codex",' +
        '"placement":{"_tag":"InPlace"},"permissionMode":"auto","model":null,"prompt":"hi",' +
        '"attachments":[]}'
    );

    const fork = decodeCommand(
      '{"_tag":"ForkSession","sessionId":"f","fromSessionId":"s","fromTurnId":"t","harness":"claude"}'
    );

    expect(start).toMatchObject({ effort: null });
    expect(fork).toMatchObject({ model: null, effort: null });
  });

  test("every catalogue entry is a capability; an older peer drops names it doesn't know", () => {
    const decode = Schema.decodeUnknownSync(CapabilityList);

    expect(decode(HARNESS_CATALOGUE.map((harness) => harness.capability))).toEqual([
      "harness.claude",
      "harness.codex",
    ]);
    expect(decode(["harness.opencode", "session.set-model", "harness.models", "usage"])).toEqual([
      "session.set-model",
      "harness.models",
      "usage",
    ]);
  });

  test("Model lists, Usage and Plan Limits round-trip", () => {
    const models = new HarnessModels({
      harness: "codex",
      models: [
        new Model({
          id: "gpt-5.5",
          name: "GPT-5.5",
          description: null,
          efforts: ["low", "medium", "high", "xhigh"],
          defaultEffort: "medium",
          isDefault: true,
        }),
      ],
      switchesModel: true,
      fetchedAt: "2026-01-01T00:00:00Z",
    });

    const tokens = new TokenCounts({
      input: 10,
      cacheRead: 200,
      cacheWrite: 5,
      output: 40,
      reasoning: 12,
    });

    const usage = UsageStreamItem.cases.UsageChanged.make({
      indexedAt: "2026-01-01T01:00:00Z",
      buckets: [
        new UsageBucket({
          hour: "2026-01-01T00:00:00Z",
          harness: "claude",
          model: "claude-opus-5-5",
          sessionId: null,
          tokens,
          reportedCost: new ReportedCost({ tokens, usd: 0.12 }),
        }),
      ],
    });

    const limit = UsageStreamItem.cases.PlanLimitChanged.make({
      limit: new PlanLimit({
        harness: "claude",
        kind: "five-hour",
        scope: null,
        windowMinutes: 300,
        usedPercent: 42,
        status: "ok",
        resetsAt: "2026-01-01T05:00:00Z",
        observedAt: "2026-01-01T00:30:00Z",
        plan: "max",
      }),
    });

    const roundTrip = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S["Type"]) =>
      Schema.decodeUnknownSync(Schema.toCodecJson(schema))(
        JSON.parse(JSON.stringify(Schema.encodeSync(Schema.toCodecJson(schema))(value)))
      );

    expect(roundTrip(HarnessModels, models)).toEqual(models);
    expect(roundTrip(UsageStreamItem, usage)).toEqual(usage);
    expect(roundTrip(UsageStreamItem, limit)).toEqual(limit);
  });

  test("Harness availability round-trips; a status from a newer Daemon decodes as unknown", () => {
    const report = new HostHarnesses({
      checkedAt: "2026-01-01T00:00:00Z",
      harnesses: HARNESS_CATALOGUE.map(
        (harness) =>
          new HarnessAvailability({
            harness: harness.kind,
            status: "needs-sign-in",
            version: "9.9.9",
            minVersion: harness.minVersion,
            detail: "Not logged in",
            signInArgv: [`/usr/local/bin/${harness.kind}`, ...harness.setup.signInCommand.slice(1)],
          })
      ),
    });

    const codec = Schema.toCodecJson(HostHarnesses);
    const json = JSON.stringify(Schema.encodeSync(codec)(report));

    expect(Schema.decodeUnknownSync(Schema.fromJsonString(codec))(json)).toEqual(report);

    const [first] = Schema.encodeSync(HostHarnesses)(report).harnesses;
    expect(first?.status).toBe("needs-sign-in");
    expect(
      Schema.decodeUnknownSync(HarnessAvailability)({ ...first, status: "rate-limited" })
    ).toMatchObject({
      status: "unknown",
    });
  });

  test("every catalogue entry declares a minimum version", () => {
    for (const harness of HARNESS_CATALOGUE)
      expect(Bun.semver.satisfies(harness.minVersion, "*")).toBe(true);
  });

  test("items and Turn details from before Subagents decode as the Turn's own", () => {
    const completed = decodeEventJson(
      '{"_tag":"TurnItemCompleted","sessionId":"s","turnId":"t",' +
        '"item":{"_tag":"AssistantMessage","id":"m","text":"hi"}}'
    );

    expect(completed).toMatchObject({ subagentId: null });

    const detail = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(TurnDetail)))(
      `{"turn":${legacyTurn},"items":[]}`
    );

    expect(detail.subagents).toEqual([]);
  });

  test("SubagentStarted and SubagentEnded round-trip", () => {
    const at = (status: "working" | "completed", endedAt: string | null) =>
      new Subagent({
        id: SubagentId.make("toolu_1"),
        sessionId: SessionId.make("s"),
        turnId: TurnId.make("t"),
        parentItemId: "toolu_1",
        title: "Check frame timing at 180 Hz",
        agent: "Explore",
        model: "haiku",
        status,
        startedAt: "2026-01-01T00:00:00Z",
        endedAt,
      });

    const subagent = at("working", null);

    const started = DomainEvent.cases.SubagentStarted.make({ subagent });

    const ended = DomainEvent.cases.SubagentEnded.make({
      subagent: at("completed", "2026-01-01T00:01:00Z"),
    });

    for (const event of [started, ended]) {
      expect(decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))).toEqual(event);
    }
  });
});
