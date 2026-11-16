import { describe, expect, test } from "bun:test";
import { Command } from "./commands.ts";
import { Actor, NotGranted } from "./extensions.ts";
import { decideTurnAccess } from "./grants.ts";
import { PersonId, SessionId, ShareId, TurnId } from "./ids.ts";
import { mayChangeQueuedTurn, QueuedTurn } from "./queuedTurns.ts";
import { decideShareAccess } from "./shareGrants.ts";
import { Share, SHARE_ROLE_GRANTS, SharePerson, type ShareRole, ShareTarget } from "./shares.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const session = SessionId.make("s1");

const teammate = (id: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${id}`),
    personId: PersonId.make(id),
    name: id,
  });

const queuedBy = (actor: Actor) =>
  new QueuedTurn({
    id: TurnId.make("t1"),
    sessionId: session,
    prompt: "next",
    attachments: [],
    actor,
    queuedAt: new Date(NOW).toISOString(),
  });

const share = (role: ShareRole) =>
  new Share({
    id: ShareId.make("share-ana"),
    target: ShareTarget.cases.Session.make({ sessionId: session }),
    issuer: "https://accounts.example",
    person: new SharePerson({
      id: PersonId.make("ana"),
      login: "ana",
      name: "Ana",
      avatarUrl: null,
      commitEmail: null,
    }),
    role,
    grant: SHARE_ROLE_GRANTS[role],
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    revokedAt: null,
  });

describe("queued Turns", () => {
  test("its author and the owner may change a queued Turn; another Teammate may not", () => {
    const anas = queuedBy(teammate("ana"));

    expect(mayChangeQueuedTurn(anas, teammate("ana"))).toBe(true);
    expect(mayChangeQueuedTurn(anas, Actor.cases.Client.make({}))).toBe(true);
    expect(mayChangeQueuedTurn(anas, teammate("bob"))).toBe(false);
    // The owner's own queued Turn is not a Teammate's to change.
    expect(mayChangeQueuedTurn(queuedBy(Actor.cases.Client.make({})), teammate("ana"))).toBe(false);
  });

  test.each(["CancelQueuedTurn", "EditQueuedTurn"])(
    "%s takes the turn Grant: a Contributor's Share allows it, a Commenter's does not",
    (command) => {
      const touch = { sessionId: session, constellationId: null };

      expect(decideShareAccess([share("contributor")], NOW, "dispatch", command, touch)).toBeNull();
      expect(decideShareAccess([share("commenter")], NOW, "dispatch", command, touch)).toEqual(
        new NotGranted({ what: `dispatch:${command}`, needed: "turn" })
      );
    }
  );

  test("editing a queued Turn of a session that approves for itself needs approve; cancelling does not", () => {
    const turnOnly = ["read", "turn"] as const;
    const target = { sessionId: session, turnId: TurnId.make("t1") };
    const edit = Command.cases.EditQueuedTurn.make({ ...target, prompt: "rm -rf" });

    expect(decideTurnAccess(turnOnly, edit, "auto")).toEqual(
      new NotGranted({ what: "dispatch:EditQueuedTurn", needed: "approve" })
    );
    expect(decideTurnAccess(turnOnly, edit, "supervised")).toBeNull();
    expect(decideTurnAccess(SHARE_ROLE_GRANTS.contributor, edit, "auto")).toBeNull();
    expect(
      decideTurnAccess(turnOnly, Command.cases.CancelQueuedTurn.make(target), "auto")
    ).toBeNull();
  });
});
