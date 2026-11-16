import { expect, test } from "bun:test";
import {
  Command,
  ConstellationId,
  GitDiffSpec,
  GRANT_KINDS,
  HostId,
  NotGranted,
  NotShared,
  PersonId,
  ReviewAction,
  SessionId,
  Share,
  ShareId,
  SharePerson,
  ShareTarget,
  type ShareTouch,
  type Turn,
  TurnId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ConstellationRecord } from "../store/constellation.ts";
import { emptyModel, patchSession, patchTurn, type ReadModel } from "../store/model.ts";
import { session, turn as turnFixture, workerSession } from "../push/push.testing.ts";
import {
  coveringShare,
  decideTeammate,
  decodeSubject,
  type DiffTurns,
  diffTurnsOf,
  type RequestSubject,
  subjectOf,
  type TeammateRequest,
} from "./gate.ts";
import { targetsOf } from "./targets.ts";

const HOST = "host-1";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const S1 = SessionId.make("s1");

const share = (fields: Partial<Share> = {}) =>
  new Share({
    id: ShareId.make("share_1"),
    target: ShareTarget.cases.Session.make({ sessionId: S1 }),
    issuer: "https://accounts.test",
    person: new SharePerson({
      id: PersonId.make("p1"),
      login: "octocat",
      name: "The Octocat",
      avatarUrl: null,
      commitEmail: null,
    }),
    role: "contributor",
    grant: GRANT_KINDS,
    createdAt: "2026-11-16T00:00:00.000Z",
    expiresAt: "2026-11-17T00:00:00.000Z",
    revokedAt: null,
    ...fields,
  });

const C1 = ConstellationId.make("c1");

const touch: ShareTouch = { sessionId: S1, constellationId: null };

const named = (fields: Partial<RequestSubject> = {}): RequestSubject => ({
  command: null,
  sessionId: S1,
  constellationId: null,
  cwd: null,
  turnIds: [],
  placements: [],
  review: null,
  ...fields,
});

const request = (rpc: string, subject: RequestSubject, fields: Partial<TeammateRequest> = {}) =>
  decideTeammate({
    shares: [share()],
    now: NOW,
    rpc,
    subject,
    touch,
    sessionCwd: "/repo",
    diffTurns: "ended",
    mayAct: false,
    hostId: HOST,
    ...fields,
  });

const dispatch = (command: string) => named({ command });

test.each(["SendTurn", "Steer", "Interrupt", "Continue", "Retry", "SendFeedback"])(
  "a Contributor's %s is refused while Teammates may not act, and allowed once they may",
  (tag) => {
    const refusal = request("dispatch", dispatch(tag));

    expect(refusal).toBeInstanceOf(NotGranted);
    expect(refusal).toMatchObject({ what: `dispatch:${tag}`, needed: "turn" });
    expect(request("dispatch", dispatch(tag), { mayAct: true })).toBeNull();
  }
);

test("a Contributor answers approvals even while Turns are held back; a Commenter can't", () => {
  expect(request("dispatch", dispatch("RespondToApproval"))).toBeNull();
  const commenter = share({ role: "commenter", grant: ["read", "comment"] });
  const refusal = request("dispatch", dispatch("RespondToApproval"), { shares: [commenter] });

  expect(refusal).toBeInstanceOf(NotGranted);
  expect(refusal).toMatchObject({ needed: "approve" });
});

const constellationShare = (role: "contributor" | "commenter") =>
  share({
    target: ShareTarget.cases.Constellation.make({ constellationId: C1 }),
    role,
    grant: role === "contributor" ? GRANT_KINDS : ["read", "comment"],
  });

/** A Constellation call by its Teammate, its payload decoded as the gate reads it. */
/** What a Constellation call's payload may say of where Workers run. */
interface LeadPayload {
  readonly defaultWorker?: WorkerPlacement;
  readonly tasks?: ReadonlyArray<{ readonly taskId: string; readonly worker: WorkerPlacement }>;
  readonly action?: ReviewAction;
}

const lead = (rpc: string, shared: Share, payload: LeadPayload = {}, mayAct = true) =>
  request(rpc, subjectOf(rpc, decodeSubject({ constellationId: C1, ...payload })), {
    shares: [shared],
    touch: { sessionId: null, constellationId: C1 },
    mayAct,
  });

const here = WorkerPlacement.cases.New.make({ hostId: HostId.make(HOST) });

test.each([
  ["constellation.dispatch", { defaultWorker: here }, "start"],
  ["constellation.worker.start", {}, "start"],
  ["constellation.review", { action: ReviewAction.cases.Approve.make({}) }, "approve"],
  ["constellation.answer", {}, "turn"],
  ["constellation.message", {}, "turn"],
])(
  "a Contributor of the Constellation may call %s; a Commenter lacks its Grant",
  (rpc, payload, needed) => {
    expect(lead(rpc, constellationShare("contributor"), payload)).toBeNull();
    const refusal = lead(rpc, constellationShare("commenter"), payload);

    expect(refusal).toBeInstanceOf(NotGranted);
    expect(refusal).toMatchObject({ needed });
  }
);

test.each([
  ["constellation.dispatch", { defaultWorker: here }],
  ["constellation.worker.start", {}],
  ["constellation.answer", {}],
  ["constellation.message", {}],
  [
    "constellation.review",
    { action: ReviewAction.cases.SendBack.make({ reason: "redo", worker: here }) },
  ],
])("%s starts agent work, so it waits with Turns while Teammates may not act", (rpc, payload) => {
  const refusal = lead(rpc, constellationShare("contributor"), payload, false);

  expect(refusal).toBeInstanceOf(NotGranted);
  expect(refusal).toMatchObject({ what: rpc, needed: "turn" });
});

test("accepting a Claim starts no agent, so a Contributor may while Turns wait", () => {
  const accept = ReviewAction.cases.Accept.make({ mergedHead: "abc", receipts: [] });

  expect(
    lead("constellation.review", constellationShare("contributor"), { action: accept }, false)
  ).toBeNull();
});

test.each([
  ["an existing session", WorkerPlacement.cases.Existing.make({ sessionId: S1 })],
  ["another Host", WorkerPlacement.cases.New.make({ hostId: HostId.make("host-2") })],
  [
    "a Worktree it names",
    WorkerPlacement.cases.New.make({ hostId: HostId.make(HOST), worktree: "/elsewhere" }),
  ],
])("a Teammate never places a Worker in %s", (_, worker) => {
  const contributor = constellationShare("contributor");
  const sendBack = ReviewAction.cases.SendBack.make({ reason: "redo", worker });

  for (const [rpc, payload] of [
    ["constellation.dispatch", { defaultWorker: worker }],
    ["constellation.dispatch", { tasks: [{ taskId: "t1", worker }] }],
    ["constellation.review", { action: sendBack }],
  ] as const)
    expect(lead(rpc, contributor, payload)).toBeInstanceOf(NotShared);
});

test.each(["constellation.plan", "constellation.set_state", "constellation.defaults.set"])(
  "%s stays the owner's, even for a Contributor",
  (rpc) => {
    expect(lead(rpc, constellationShare("contributor"))).toBeInstanceOf(NotShared);
  }
);

test("a Contributor's Lead action needs a Share of that Constellation", () => {
  const elsewhere = request(
    "constellation.review",
    named({ sessionId: null, constellationId: ConstellationId.make("c2") }),
    {
      shares: [constellationShare("contributor")],
      touch: { sessionId: null, constellationId: ConstellationId.make("c2") },
    }
  );

  expect(elsewhere).toBeInstanceOf(NotShared);
});

test("muting names its target, so only a Share of that target lets a Teammate mute it", () => {
  const target = ShareTarget.cases.Session.make({ sessionId: S1 });

  expect(subjectOf("shares.mute", decodeSubject({ target, muted: true }))).toMatchObject({
    sessionId: S1,
  });
});

test("Comments and the Contributor's own commands pass while Turns are held back", () => {
  expect(request("dispatch", dispatch("AddComment"))).toBeNull();
  expect(request("dispatch", dispatch("RenameSession"))).toBeNull();
});

test("a command the allowlist doesn't name is the owner's", () => {
  expect(request("dispatch", dispatch("ArchiveSession"), { mayAct: true })).toBeInstanceOf(
    NotShared
  );
});

test("a shared session's diff is read only where that session runs", () => {
  expect(request("git.diff", named({ cwd: "/repo" }))).toBeNull();
  const elsewhere = request("git.diff", named({ cwd: "/repo.worktrees/other" }));

  expect(elsewhere).toBeInstanceOf(NotShared);
  expect(elsewhere).toMatchObject({ what: "git.diff" });
});

test.each([
  ["the working tree", GitDiffSpec.cases.WorkingTree.make({ base: null })],
  ["a range", GitDiffSpec.cases.Range.make({ base: "main", head: "HEAD" })],
])("a diff of %s names a path, which no Share covers", (_, spec) => {
  const subject = subjectOf("git.diff", decodeSubject({ cwd: "/repo", spec }));

  expect(subject.sessionId).toBeNull();
  expect(
    request("git.diff", subject, { touch: { sessionId: null, constellationId: null } })
  ).toBeInstanceOf(NotShared);
});

test("a request names its session wherever the payload carries it", () => {
  const sendTurn = Command.cases.SendTurn.make({ sessionId: S1, prompt: "hi", attachments: [] });
  const turn = GitDiffSpec.cases.Turn.make({ sessionId: S1, turnId: TurnId.make("t1") });
  const target = ShareTarget.cases.Constellation.make({ constellationId: C1 });

  expect(
    subjectOf("subscribeSession", decodeSubject({ sessionId: S1, afterSequence: null }))
  ).toEqual(named());
  expect(subjectOf("dispatch", decodeSubject({ commandId: "c1", command: sendTurn }))).toEqual(
    named({ command: "SendTurn" })
  );
  expect(subjectOf("git.diff", decodeSubject({ cwd: "/repo", spec: turn }))).toEqual(
    named({ cwd: "/repo", turnIds: [TurnId.make("t1")] })
  );
  expect(subjectOf("shares.watchPresence", decodeSubject({ target }))).toEqual(
    named({ sessionId: null, constellationId: C1 })
  );
  expect(subjectOf("files.read", decodeSubject({ path: "/etc/passwd" }))).toEqual(
    named({ sessionId: null })
  );
});

test("a request acts through a Contributor's Share when two cover it", () => {
  const commenter = share({ id: ShareId.make("share_c"), role: "commenter", grant: ["read"] });
  const contributor = share({ id: ShareId.make("share_w") });
  const ended = share({ id: ShareId.make("share_x"), revokedAt: "2026-11-16T01:00:00.000Z" });

  expect(coveringShare([commenter, contributor], NOW, touch)?.id).toBe(contributor.id);
  expect(coveringShare([commenter], NOW, touch)?.id).toBe(commenter.id);
  expect(coveringShare([ended], NOW, touch)).toBeNull();
  expect(coveringShare([contributor], NOW, { sessionId: null, constellationId: null })).toBeNull();
});

const LEAD = SessionId.make("lead");

const leadSession = patchSession(session, { id: LEAD });

/** A model with a Constellation led by `lead`, its Worker `s1`, and a session outside it. */
const model = (): ReadModel => {
  const record = (listed: typeof session) => ({
    session: listed,
    titleLocked: false,
    turns: [],
    pending: new Map(),
    subagents: new Map(),
  });

  // SAFETY: the resolver reads only `graph.id` and `graph.leadSessionId` of a Constellation.
  const constellation = { graph: { id: C1, leadSessionId: LEAD } } as ConstellationRecord;

  return {
    ...emptyModel,
    constellations: new Map([[C1, constellation]]),
    sessions: new Map([
      [S1, record(workerSession)],
      [LEAD, record(leadSession)],
      [SessionId.make("alone"), record(session)],
    ]),
  };
};

test("a session touches its Constellation as its Lead or as a Worker, and a Worker is marked", async () => {
  const targets = targetsOf(Effect.sync(model), () => Effect.succeed(null));
  const worker = await Effect.runPromise(targets.session(S1));
  const lead = await Effect.runPromise(targets.session(LEAD));
  const alone = await Effect.runPromise(targets.session(SessionId.make("alone")));

  expect(worker).toMatchObject({ touch: { sessionId: S1, constellationId: C1 }, worker: true });
  expect(lead).toMatchObject({ touch: { sessionId: LEAD, constellationId: C1 }, worker: false });
  expect(alone?.touch.constellationId).toBeNull();
  expect(await Effect.runPromise(targets.session(SessionId.make("gone")))).toBeNull();
  expect(await Effect.runPromise(targets.hasConstellation(C1))).toBe(true);
});

test.each(["missing", null] as const)(
  "a diff whose Turns are %p in the shared session is refused",
  (diffTurns) => {
    const refusal = request("git.diff", named({ cwd: "/repo" }), { diffTurns });

    expect(refusal).toBeInstanceOf(NotShared);
    expect(request("git.diff", named({ cwd: "/repo" }), { diffTurns: "working" })).toBeNull();
  }
);

/** A session with an ended Turn 1 and a working Turn 2; `old` is only in SQL, as Turn 0. */
const turnTargets = () => {
  const turn = (id: string, index: number, status: Turn["status"]) =>
    patchTurn(turnFixture(id, null, status), { index });

  const withTurns: ReadModel = {
    ...emptyModel,
    sessions: new Map([
      [
        S1,
        {
          session,
          titleLocked: false,
          turns: [turn("done", 1, "completed"), turn("live", 2, "working")],
          pending: new Map(),
          subagents: new Map(),
        },
      ],
    ]),
  };

  return targetsOf(Effect.succeed(withTurns), (sessionId, turnId) =>
    Effect.succeed(sessionId === S1 && turnId === "old" ? turn("old", 0, "completed") : null)
  );
};

const turnsCases: ReadonlyArray<readonly [string, ReadonlyArray<string>, DiffTurns | null]> = [
  ["one ended Turn", ["done"], "ended"],
  ["a Turn still working", ["live"], "working"],
  ["a run that ends at the working Turn", ["done", "live"], "working"],
  ["a run from a Turn only the store still holds", ["old", "done"], "ended"],
  ["a real first Turn and a last one that never ran", ["done", "never-ran"], "missing"],
  ["a first Turn that never ran", ["never-ran", "done"], "missing"],
  ["a run named backwards", ["live", "done"], "missing"],
  ["no Turn at all", [], null],
];

test.each(turnsCases)("a diff of %s reads as %p from Host state", async (_, ids, expected) => {
  const subject = named({ cwd: "/repo", turnIds: ids.map((id) => TurnId.make(id)) });

  expect(await Effect.runPromise(diffTurnsOf(turnTargets(), subject))).toBe(expected);
});

test("a Turn of another session is not the shared session's", async () => {
  const other = named({ sessionId: SessionId.make("alone"), turnIds: [TurnId.make("done")] });

  expect(await Effect.runPromise(diffTurnsOf(turnTargets(), other))).toBe("missing");
});
