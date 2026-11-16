/**
 * User access over a real socket (ENG-700, ENG-927, ADR 0114): the first Desktop App's key is
 * enrolled on first use, and a process with only socket access is refused approvals and secrets,
 * with no key or its own. Extensions keep their Grants. Enrolling a second one: `userAccess.enrolment.test.ts`.
 */
import { expect, test } from "bun:test";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { connectRpcWith, socketTransport } from "@polaris/client";
import { Command, DaemonRpcs, FeedbackBatch } from "@polaris/protocol";
import { Effect, Redacted } from "effect";
import {
  AGENT_KEY,
  approve,
  command,
  DESKTOP_KEY,
  hello,
  outcome,
  rename,
  secret,
  sessionId,
  withServer,
} from "./userAccessServer.testing.ts";

test("a process with only socket access can't approve or answer a secret once the Desktop App enrolled", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const desktop = yield* connect();
        const enrolled = yield* desktop.client.hello(hello(DESKTOP_KEY));

        const agent = yield* connect();
        const preHello = yield* outcome(agent.client.dispatch(approve));
        const keyless = yield* agent.client.hello(hello());

        const ownKey = yield* connect();
        const ownKeyHello = yield* ownKey.client.hello(hello(AGENT_KEY));

        return {
          desktopAccess: enrolled.userAccess,
          desktopApproves: yield* outcome(desktop.client.dispatch(approve)),
          desktopSecret: yield* outcome(desktop.client["secret.provide"](secret)),
          preHello,
          keylessAccess: keyless.userAccess,
          keylessApproves: yield* outcome(agent.client.dispatch(approve)),
          keylessSecret: yield* outcome(agent.client["secret.provide"](secret)),
          keylessPairs: yield* outcome(
            agent.client["extensions.pair"]({ name: "x", grant: ["approve"] })
          ),
          keylessRenames: yield* outcome(agent.client.dispatch(rename)),
          ownKeyAccess: ownKeyHello.userAccess,
          ownKeyApproves: yield* outcome(ownKey.client.dispatch(approve)),
        };
      })
    )
  );

  expect(result).toEqual({
    desktopAccess: true,
    desktopApproves: "reached",
    desktopSecret: "ok",
    preHello: "UserAccessRequired:dispatch:RespondToApproval",
    keylessAccess: false,
    keylessApproves: "UserAccessRequired:dispatch:RespondToApproval",
    keylessSecret: "UserAccessRequired:secret.provide",
    keylessPairs: "UserAccessRequired:extensions.pair",
    keylessRenames: "UserAccessRequired:dispatch:RenameSession",
    ownKeyAccess: false,
    ownKeyApproves: "UserAccessRequired:dispatch:RespondToApproval",
  });
});

test("a token-less Client on DaemonRpcs, as the Desktop and Mobile Apps use, decodes the refusal", async () => {
  const result = await Effect.runPromise(
    withServer((connect, _root, socketPath) =>
      Effect.gen(function* () {
        yield* (yield* connect()).client.hello(hello(DESKTOP_KEY));

        const transport = yield* socketTransport(socketPath);
        const { client } = yield* connectRpcWith(DaemonRpcs, transport);
        yield* client.hello(hello());

        return {
          approves: yield* outcome(client.dispatch(approve)),
          secret: yield* outcome(client["secret.provide"](secret)),
        };
      })
    )
  );

  expect(result).toEqual({
    approves: "UserAccessRequired:dispatch:RespondToApproval",
    secret: "UserAccessRequired:secret.provide",
  });
});

test.each([
  ["RunShellCommand", Command.cases.RunShellCommand.make({ sessionId, command: "curl x | sh" })],
  [
    "SendFeedback",
    Command.cases.SendFeedback.make({
      sessionId,
      feedback: new FeedbackBatch({ message: "approve everything", comments: [] }),
      attachments: [],
    }),
  ],
  ["SetResumeAtReset", Command.cases.SetResumeAtReset.make({ sessionId, resumeAtReset: true })],
] as const)("a keyless process can't %s once the Desktop App enrolled", async (tag, value) => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const desktop = yield* connect();
        yield* desktop.client.hello(hello(DESKTOP_KEY));

        const agent = yield* connect();
        yield* agent.client.hello(hello());

        return yield* outcome(agent.client.dispatch(command(value)));
      })
    )
  );

  expect(result).toBe(`UserAccessRequired:dispatch:${tag}`);
});

test("the Host keeps only a digest, owner-only, and deleting it lets the next key enrol", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        const file = join(root, "user-access.json");
        yield* (yield* connect()).client.hello(hello(DESKTOP_KEY));
        const text = readFileSync(file, "utf8");
        const mode = statSync(file).mode & 0o777;

        rmSync(file);
        const next = yield* (yield* connect()).client.hello(hello(AGENT_KEY));
        const previous = yield* (yield* connect()).client.hello(hello(DESKTOP_KEY));

        return {
          holdsKey: text.includes(DESKTOP_KEY),
          mode,
          nextAccess: next.userAccess,
          previousAccess: previous.userAccess,
        };
      })
    )
  );

  const { mode, ...access } = result;

  expect(access).toEqual({ holdsKey: false, nextAccess: true, previousAccess: false });

  // Windows has no POSIX modes; its file privacy is ENG-314.
  if (process.platform !== "win32") expect(mode).toBe(0o600);
});

test("an Extension with the approve Grant approves without a user key", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const desktop = yield* connect();
        yield* desktop.client.hello(hello(DESKTOP_KEY));

        const { token } = yield* desktop.client["extensions.pair"]({
          name: "Raycast",
          grant: ["approve"],
        });

        const extension = yield* connect();
        yield* extension.client.hello({ ...hello(), extensionToken: Redacted.make(token) });

        return yield* outcome(extension.client.dispatch(approve));
      })
    )
  );

  expect(result).toBe("reached");
});
