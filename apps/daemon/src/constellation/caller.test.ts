import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Context } from "effect";
import { ConnectionUserAccess } from "../userAccess/index.ts";
import { ConstellationCaller, isUserCaller } from "./rpc.ts";

const held = (holds: boolean) => Context.make(ConnectionUserAccess, { holds: () => holds });

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
