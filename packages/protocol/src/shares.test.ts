import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { CommentAnchor, Comment, commentsPrompt, mayResolveComment } from "./comments.ts";
import { Command } from "./commands.ts";
import { ConstellationId } from "./constellation/domain.ts";
import { Actor, actorFor, NotGranted } from "./extensions.ts";
import { decideTurnAccess } from "./grants.ts";
import { CommentId, PersonId, SessionId, ShareId, TurnId } from "./ids.ts";
import { FeedbackBatch } from "./review.ts";
import { decideShareAccess, SHARE_RPCS, TeammateRpcs } from "./shareGrants.ts";
import {
  NotShared,
  Share,
  SHARE_ROLE_GRANTS,
  shareExpiry,
  SharePerson,
  type ShareRole,
  ShareTarget,
} from "./shares.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const DAY = 24 * 60 * 60 * 1000;

const session = SessionId.make("s1");

const other = SessionId.make("s2");

const constellation = ConstellationId.make("c1");

const person = (id: string) =>
  new SharePerson({
    id: PersonId.make(id),
    login: id,
    name: id,
    avatarUrl: null,
    commitEmail: null,
  });

const share = (role: ShareRole, target: ShareTarget, patch: Partial<Share> = {}) =>
  new Share({
    id: ShareId.make(`share-${role}`),
    target,
    issuer: "https://accounts.example",
    person: person("ada"),
    role,
    grant: SHARE_ROLE_GRANTS[role],
    createdAt: new Date(NOW - DAY).toISOString(),
    expiresAt: new Date(NOW + DAY).toISOString(),
    revokedAt: null,
    ...patch,
  });

const onSession = ShareTarget.cases.Session.make({ sessionId: session });

const touching = (sessionId: SessionId | null, constellationId: ConstellationId | null = null) => ({
  sessionId,
  constellationId,
});

const teammate = (id: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make("share-1"),
    personId: PersonId.make(id),
    name: id,
  });

describe("a Share's expiry", () => {
  test("defaults to seven days", () => {
    expect(shareExpiry(NOW, null)).toBe(new Date(NOW + 7 * DAY).toISOString());
  });

  test("is refused past thirty days, and in the past", () => {
    const at = (ms: number) => new Date(ms).toISOString();

    expect(shareExpiry(NOW, at(NOW + 30 * DAY))).toBe(at(NOW + 30 * DAY));
    expect(shareExpiry(NOW, at(NOW + 30 * DAY + 1))).toBeNull();
    expect(shareExpiry(NOW, at(NOW))).toBeNull();
  });
});

describe("the Share gate", () => {
  test("a request outside the Share's target is refused", () => {
    const shares = [share("contributor", onSession)];

    expect(decideShareAccess(shares, NOW, "subscribeSession", null, touching(session))).toBeNull();
    expect(decideShareAccess(shares, NOW, "subscribeSession", null, touching(other))).toEqual(
      new NotShared({ what: "subscribeSession" })
    );

    expect(decideShareAccess(shares, NOW, "dispatch", "SendTurn", touching(other))).toEqual(
      new NotShared({ what: "dispatch:SendTurn" })
    );
  });

  test("a Constellation Share covers its sessions, and nothing else", () => {
    const shares = [
      share(
        "contributor",
        ShareTarget.cases.Constellation.make({ constellationId: constellation })
      ),
    ];

    const worker = touching(other, constellation);

    expect(decideShareAccess(shares, NOW, "dispatch", "SendTurn", worker)).toBeNull();
    expect(decideShareAccess(shares, NOW, "constellation.subscribe", null, worker)).toBeNull();
    expect(
      decideShareAccess(shares, NOW, "subscribeSession", null, touching(session))
    ).toBeInstanceOf(NotShared);
  });

  test("a Commenter watches and comments, but sends no Turn and answers no approval", () => {
    const shares = [share("commenter", onSession)];

    const dispatch = (command: string) =>
      decideShareAccess(shares, NOW, "dispatch", command, touching(session));

    expect(dispatch("AddComment")).toBeNull();
    expect(dispatch("ResolveComment")).toBeNull();
    expect(dispatch("SendTurn")).toEqual(
      new NotGranted({ what: "dispatch:SendTurn", needed: "turn" })
    );

    expect(dispatch("SendFeedback")).toEqual(
      new NotGranted({ what: "dispatch:SendFeedback", needed: "turn" })
    );

    expect(dispatch("RespondToApproval")).toEqual(
      new NotGranted({ what: "dispatch:RespondToApproval", needed: "approve" })
    );

    for (const command of ["SetModel", "SetPermissionMode", "RenameSession", "AcceptTurns"])
      expect(dispatch(command)).toEqual(new NotShared({ what: `dispatch:${command}` }));
  });

  test("a Contributor acts in the shared session as the owner can", () => {
    const shares = [share("contributor", onSession)];

    const commands = [
      "SendTurn",
      "Steer",
      "Interrupt",
      "Continue",
      "Retry",
      "SendFeedback",
      "RespondToApproval",
      "SetModel",
      "SetPermissionMode",
      "RenameSession",
      "AcceptTurns",
      "AddComment",
    ];

    for (const command of commands) {
      expect(decideShareAccess(shares, NOW, "dispatch", command, touching(session))).toBeNull();
      expect(decideShareAccess(shares, NOW, "dispatch", command, touching(other))).toBeInstanceOf(
        NotShared
      );
    }
  });

  test("an ended Share admits nothing", () => {
    const expired = [share("contributor", onSession, { expiresAt: new Date(NOW).toISOString() })];

    const revoked = [
      share("contributor", onSession, { revokedAt: new Date(NOW - 1).toISOString() }),
    ];

    for (const shares of [expired, revoked, []])
      expect(
        decideShareAccess(shares, NOW, "subscribeSession", null, touching(session))
      ).toBeInstanceOf(NotShared);
  });

  test("what stays the owner's is refused even inside the target", () => {
    const shares = [share("contributor", onSession)];

    const refused = [
      ["files.write", null],
      ["terminal.open", null],
      ["shares.create", null],
      ["subscribeHost", null],
      ["dispatch", "ArchiveSession"],
      ["dispatch", "ForkSession"],
      ["dispatch", "RunShellCommand"],
      ["shares.revoke", null],
      ["files.read", null],
      ["dispatch", null],
      ["dispatch", "toString"],
    ] as const;

    for (const [rpc, command] of refused)
      expect(decideShareAccess(shares, NOW, rpc, command, touching(session))).toBeInstanceOf(
        NotShared
      );
  });

  test("hello and a statement refresh pass with no live Share", () => {
    expect(decideShareAccess([], NOW, "hello", null, touching(null))).toBeNull();
    expect(decideShareAccess([], NOW, "account.refreshStatement", null, touching(null))).toBeNull();
  });

  test("a Teammate's Client can call exactly what the gate lists", () => {
    expect([...TeammateRpcs.requests.keys()].toSorted()).toEqual(
      Object.keys(SHARE_RPCS).toSorted()
    );
  });

  test("feedback into a session that approves for itself needs approve as well", () => {
    const feedback = Command.cases.SendFeedback.make({
      sessionId: session,
      feedback: new FeedbackBatch({ message: "fix these", comments: [] }),
      attachments: [],
      commentIds: [CommentId.make("c1")],
    });

    expect(decideTurnAccess(["read", "comment", "turn"], feedback, "auto")).toEqual(
      new NotGranted({ what: "dispatch:SendFeedback", needed: "approve" })
    );

    expect(decideTurnAccess(["read", "comment", "turn"], feedback, "supervised")).toBeNull();
    expect(decideTurnAccess(SHARE_ROLE_GRANTS.contributor, feedback, "auto")).toBeNull();
  });
});

describe("old Clients", () => {
  test("read a Teammate as a Client unless they announced it", () => {
    const actor = teammate("ada");

    expect(actorFor(actor, ["actor.linked-device"])).toEqual(Actor.cases.Client.make({}));
    expect(actorFor(actor, ["actor.teammate"])).toBe(actor);
  });

  test("send feedback that names no Comments", () => {
    const wire =
      '{"_tag":"SendFeedback","sessionId":"s1","feedback":{"message":null,"comments":[]},"attachments":[]}';

    const command = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(Command)))(
      wire
    );

    expect(command).not.toHaveProperty("commentIds");
  });
});

describe("Comments", () => {
  const comment = (author: Actor, anchor: CommentAnchor, body: string) =>
    new Comment({
      id: CommentId.make("c1"),
      sessionId: session,
      anchor,
      body,
      author,
      createdAt: new Date(NOW).toISOString(),
    });

  const lines = CommentAnchor.cases.DiffLines.make({
    turnId: TurnId.make("t1"),
    path: "src/a.ts",
    side: "old",
    start: 3,
    end: 4,
    code: "const a = 1;\nconst b = 2;",
  });

  test("its author, the owner or a Contributor resolves one; another Commenter does not", () => {
    const mine = comment(teammate("ada"), lines, "why?");

    expect(mayResolveComment(mine, teammate("ada"), "commenter")).toBe(true);
    expect(mayResolveComment(mine, teammate("bob"), "commenter")).toBe(false);
    expect(mayResolveComment(mine, teammate("bob"), "contributor")).toBe(true);
    expect(mayResolveComment(mine, Actor.cases.Client.make({}), null)).toBe(true);
  });

  test("are sent as the message, then each anchor, its quote and its body", () => {
    const quote = CommentAnchor.cases.MessageText.make({
      turnId: TurnId.make("t1"),
      messageId: "m1",
      start: 0,
      end: 9,
      quote: "I used a mutex",
    });

    const prompt = commentsPrompt("Two things", [
      comment(teammate("ada"), lines, " keep both "),
      comment(teammate("bob"), quote, "a channel is simpler"),
    ]);

    expect(prompt).toBe(
      [
        "Two things",
        "src/a.ts:3-4 (removed lines)\n```\nconst a = 1;\nconst b = 2;\n```\nkeep both",
        "From a message\n```\nI used a mutex\n```\na channel is simpler",
      ].join("\n\n")
    );
  });
});
