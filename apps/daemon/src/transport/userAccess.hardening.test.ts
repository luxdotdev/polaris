/**
 * What a socket-only process could do around the user gate, over a real socket (ENG-927,
 * ADR 0114): reset enrolment, run a program, outlive a revoke, or empty the registry.
 */
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, type UserAccessState, WorkspaceId } from "@polaris/protocol";
import { Effect, Fiber, Option, Stream } from "effect";
import {
  AGENT_KEY,
  approve,
  command,
  type Connect,
  DESKTOP_KEY,
  hello,
  outcome,
  sessionId,
  withServer,
} from "./userAccessServer.testing.ts";

const LAPTOP_KEY = "c".repeat(64);

type Client = Effect.Success<ReturnType<Connect>>["client"];

const stateWhen = (client: Client, ready: (state: UserAccessState) => boolean) =>
  client["userAccess.watch"]().pipe(
    Stream.filter(ready),
    Stream.runHead,
    Effect.map(Option.getOrNull),
    Effect.timeout("5 seconds")
  );

const app = (connect: Connect, key: string | undefined, label: string) =>
  Effect.gen(function* () {
    const { client } = yield* connect();
    const answer = yield* client.hello(hello(key, label));

    return { client, access: answer.userAccess };
  });

/** A second Desktop App, allowed by the first. */
const allowed = (connect: Connect, studio: Client) =>
  Effect.gen(function* () {
    const laptop = yield* app(connect, LAPTOP_KEY, "MacBook Pro");
    const asked = yield* stateWhen(studio, (state) => state.requests.length === 1);
    const id = asked?.requests[0]?.id;

    if (id === undefined) return yield* Effect.die("no request reached the enrolled app");
    yield* studio["userAccess.allow"]({ id });

    return { client: laptop.client, id };
  });

test("a socket-only process can't delete the enrolment file and enrol itself", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        const file = join(root, "user-access.json");
        yield* app(connect, DESKTOP_KEY, "Mac Studio");
        const agent = yield* app(connect, undefined, "agent");

        const deleted = yield* outcome(
          agent.client["files.delete"]({ path: file, permanent: true })
        );

        const next = yield* app(connect, AGENT_KEY, "agent");

        return { deleted, kept: existsSync(file), enrolled: next.access };
      })
    )
  );

  expect(result).toEqual({
    deleted: "UserAccessRequired:files.delete",
    kept: true,
    enrolled: false,
  });
});

test("a socket-only process can't run a program or write files through the Host", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        yield* app(connect, DESKTOP_KEY, "Mac Studio");
        const { client } = yield* app(connect, AGENT_KEY, "agent");
        const path = join(root, "planted");

        return {
          terminal: yield* outcome(
            client["terminal.open"]({
              cwd: root,
              cols: 80,
              rows: 24,
              argv: ["/bin/sh", "-c", `touch ${path}`],
            })
          ),
          create: yield* outcome(client["files.create"]({ path, kind: "file" })),
          rename: yield* outcome(
            client["files.rename"]({ path: join(root, "user-access.json"), destination: path })
          ),
          commit: yield* outcome(
            Stream.runDrain(client["git.commit"]({ cwd: root, message: "hooks run" }))
          ),
          setup: yield* outcome(
            client.dispatch(
              command(
                Command.cases.SetWorktreeSetup.make({
                  workspaceId: WorkspaceId.make("w1"),
                  setup: null,
                })
              )
            )
          ),
          planted: existsSync(path),
        };
      })
    )
  );

  expect(result).toEqual({
    terminal: "UserAccessRequired:terminal.open",
    create: "UserAccessRequired:files.create",
    rename: "UserAccessRequired:files.rename",
    commit: "UserAccessRequired:git.commit",
    setup: "UserAccessRequired:dispatch:SetWorktreeSetup",
    planted: false,
  });
});

test("revoking a Desktop App ends the user-only stream it has open", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* app(connect, DESKTOP_KEY, "Mac Studio");
        const laptop = yield* allowed(connect, studio.client);

        const preview = (client: Client) =>
          Effect.forkScoped(
            outcome(
              Stream.runDrain(
                client["computerUse.preview.watch"]({ sessionId, maxEdgePx: null, link: "local" })
              )
            )
          );

        const watching = yield* preview(laptop.client);
        const kept = yield* preview(studio.client);

        // Open on the Host before the revoke: a request made after it answers.
        yield* laptop.client.dispatch(approve).pipe(Effect.exit);
        yield* studio.client.dispatch(approve).pipe(Effect.exit);
        yield* studio.client["userAccess.revoke"]({ id: laptop.id });

        return {
          revoked: yield* Fiber.join(watching).pipe(Effect.timeout("5 seconds")),
          other: yield* Fiber.join(kept).pipe(
            Effect.timeoutOption("300 millis"),
            Effect.map(Option.getOrElse(() => "still open"))
          ),
        };
      })
    )
  );

  expect(result).toEqual({
    revoked: "UserAccessRequired:computerUse.preview.watch",
    other: "still open",
  });
});

test("the last enrolled Desktop App can't be revoked, so first use never comes back", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* app(connect, DESKTOP_KEY, "Mac Studio");
        const held = yield* stateWhen(studio.client, (state) => state.standing === "held");
        const id = held?.enrolled[0]?.id;

        if (id === undefined) return yield* Effect.die("the first Desktop App isn't enrolled");

        const revoke = yield* outcome(studio.client["userAccess.revoke"]({ id }));
        const agent = yield* app(connect, AGENT_KEY, "agent");

        return {
          revoke,
          agent: agent.access,
          still: yield* outcome(studio.client.dispatch(approve)),
        };
      })
    )
  );

  expect(result).toEqual({ revoke: "LastEnrolledApp", agent: false, still: "reached" });
});

test("an emptied registry enrols nobody and asks nobody; a missing file is a fresh Host", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        writeFileSync(join(root, "user-access.json"), JSON.stringify({ version: 2, keys: [] }));
        const agent = yield* app(connect, AGENT_KEY, "agent");
        const state = yield* stateWhen(agent.client, () => true);

        return {
          access: agent.access,
          standing: state?.standing,
          approves: yield* outcome(agent.client.dispatch(approve)),
        };
      })
    )
  );

  expect(result).toEqual({
    access: false,
    standing: "none",
    approves: "UserAccessRequired:dispatch:RespondToApproval",
  });
});
