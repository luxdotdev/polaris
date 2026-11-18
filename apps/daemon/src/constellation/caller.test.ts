import { expect, test } from "bun:test";
import { Actor, PersonId, SessionId, ShareId } from "@polaris/protocol";
import { Context, Effect } from "effect";
import { RequestShare } from "../shares/connection.ts";
import { ConnectionUserAccess } from "../userAccess/index.ts";
import { actingCaller, ConstellationCaller, isUserCaller } from "./rpc.ts";

const held = (holds: boolean) =>
  Context.make(ConnectionUserAccess, { holds: () => holds, refused: () => !holds });

test("what changes the Host takes an unbound connection for the user only while the user gate holds it", () => {
  expect({
    neverGated: isUserCaller(Context.empty()),
    revoked: isUserCaller(held(false)),
    admitted: isUserCaller(held(true)),
    boundUser: isUserCaller(Context.make(ConstellationCaller, { kind: "user" })),
    session: isUserCaller(
      Context.add(held(true), ConstellationCaller, {
        kind: "session",
        sessionId: SessionId.make("s1"),
      })
    ),
  }).toEqual({
    neverGated: false,
    revoked: false,
    admitted: true,
    boundUser: true,
    session: false,
  });
});

test("a Teammate's request acts as the user and carries their Actor; a session's binding stays its own", () => {
  const octocat = Actor.cases.Teammate.make({
    shareId: ShareId.make("share_1"),
    personId: PersonId.make("p1"),
    name: "The Octocat",
  });

  const through = (annotations: Context.Context<never>) =>
    Effect.runSync(
      actingCaller(annotations).pipe(
        Effect.provideService(RequestShare, {
          actor: octocat,
          grant: ["read", "approve"],
          role: "contributor",
        })
      )
    );

  const session = Context.make(ConstellationCaller, {
    kind: "session",
    sessionId: SessionId.make("s1"),
  });

  expect(through(Context.empty())).toEqual({ kind: "user", actor: octocat });
  expect(through(session)).toEqual({ kind: "session", sessionId: SessionId.make("s1") });
  expect(Effect.runSync(actingCaller(Context.empty()))).toEqual({ kind: "user" });
});
