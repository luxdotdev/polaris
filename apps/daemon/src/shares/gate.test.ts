import { expect, test } from "bun:test";
import {
  Command,
  ConstellationId,
  GitDiffSpec,
  GRANT_KINDS,
  NotGranted,
  NotShared,
  PersonId,
  SessionId,
  Share,
  ShareId,
  SharePerson,
  ShareTarget,
  type ShareTouch,
  TurnId,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ConstellationRecord } from "../store/constellation.ts";
import { emptyModel, patchSession, type ReadModel } from "../store/model.ts";
import { session, workerSession } from "../push/push.testing.ts";
import {
  coveringShare,
  decideTeammate,
  decodeSubject,
  type RequestSubject,
  subjectOf,
  type TeammateRequest,
} from "./gate.ts";
import { targetsOf } from "./targets.ts";

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
    mayAct: false,
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

test("a Contributor's approval answer is refused while Teammates may not act", () => {
  const refusal = request("dispatch", dispatch("RespondToApproval"));

  expect(refusal).toBeInstanceOf(NotGranted);
  expect(refusal).toMatchObject({ needed: "approve" });
  expect(request("dispatch", dispatch("RespondToApproval"), { mayAct: true })).toBeNull();
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
    named({ cwd: "/repo" })
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
  const targets = targetsOf(Effect.sync(model));
  const worker = await Effect.runPromise(targets.session(S1));
  const lead = await Effect.runPromise(targets.session(LEAD));
  const alone = await Effect.runPromise(targets.session(SessionId.make("alone")));

  expect(worker).toMatchObject({ touch: { sessionId: S1, constellationId: C1 }, worker: true });
  expect(lead).toMatchObject({ touch: { sessionId: LEAD, constellationId: C1 }, worker: false });
  expect(alone?.touch.constellationId).toBeNull();
  expect(await Effect.runPromise(targets.session(SessionId.make("gone")))).toBeNull();
  expect(await Effect.runPromise(targets.hasConstellation(C1))).toBe(true);
});
