/**
 * Several Desktop Apps on one Host, over a real socket (ENG-927, ADR 0114): a second one waits
 * until one that holds user access allows it, and revoking or denying cuts it off at once.
 */
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UserAccessState } from "@polaris/protocol";
import { Effect, Option, Stream } from "effect";
import { MAX_REQUESTS } from "../userAccess/index.ts";
import {
  AGENT_KEY,
  approve,
  type Connect,
  DESKTOP_KEY,
  hello,
  outcome,
  withServer,
} from "./userAccessServer.testing.ts";

const LAPTOP_KEY = "c".repeat(64);

type Client = Effect.Success<ReturnType<Connect>>["client"];

/** The first state the connection's watch gives that `ready` accepts. */
const stateWhen = (client: Client, ready: (state: UserAccessState) => boolean) =>
  client["userAccess.watch"]().pipe(
    Stream.filter(ready),
    Stream.runHead,
    Effect.map(Option.getOrNull),
    Effect.timeout("5 seconds")
  );

const now = (client: Client) => stateWhen(client, () => true);

/** A Desktop App connected with its key and label; `access` is what its `hello` answered. */
const desktopApp = (connect: Connect, key: string, label: string) =>
  Effect.gen(function* () {
    const { client } = yield* connect();
    const answer = yield* client.hello(hello(key, label));

    return { client, access: answer.userAccess };
  });

const keysIn = (root: string): ReadonlyArray<{ readonly label: string }> =>
  // SAFETY: the Daemon just wrote this file; the test reads its labels only.
  (
    JSON.parse(readFileSync(join(root, "user-access.json"), "utf8")) as {
      keys: ReadonlyArray<{ label: string }>;
    }
  ).keys;

test("a second Desktop App waits, then approves on the same connection once an enrolled one allows it", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");
        const laptop = yield* desktopApp(connect, LAPTOP_KEY, "MacBook Pro");
        const waiting = yield* now(laptop.client);
        const refused = yield* outcome(laptop.client.dispatch(approve));
        const asked = yield* stateWhen(studio.client, (state) => state.requests.length === 1);
        const request = asked?.requests[0];

        if (request === undefined) return yield* Effect.die("no request reached the enrolled app");

        const allowed = yield* studio.client["userAccess.allow"]({ id: request.id });
        const held = yield* stateWhen(laptop.client, (state) => state.standing === "held");

        return {
          access: [studio.access, laptop.access],
          waiting: [waiting?.standing, waiting?.enrolled.length, waiting?.requests.length],
          sameCode: waiting?.code !== null && waiting?.code === request.code,
          asked: request.label,
          refused,
          allowed: allowed.label,
          approves: yield* outcome(laptop.client.dispatch(approve)),
          laptopSees: held?.enrolled.map((app) => [app.label, app.self, app.connected]),
          stored: keysIn(root).map((key) => key.label),
          holdsKey: readFileSync(join(root, "user-access.json"), "utf8").includes(LAPTOP_KEY),
        };
      })
    )
  );

  expect(result).toEqual({
    access: [true, false],
    waiting: ["waiting", 0, 0],
    sameCode: true,
    asked: "MacBook Pro",
    refused: "UserAccessRequired:dispatch:RespondToApproval",
    allowed: "MacBook Pro",
    approves: "reached",
    laptopSees: [
      ["Mac Studio", false, true],
      ["MacBook Pro", true, true],
    ],
    stored: ["Mac Studio", "MacBook Pro"],
    holdsKey: false,
  });
});

test("revoking a Desktop App cuts its open connection off at once, and it has to ask again", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");
        const laptop = yield* desktopApp(connect, LAPTOP_KEY, "MacBook Pro");
        const asked = yield* stateWhen(studio.client, (state) => state.requests.length === 1);
        const id = asked?.requests[0]?.id;

        if (id === undefined) return yield* Effect.die("no request reached the enrolled app");
        yield* studio.client["userAccess.allow"]({ id });
        const before = yield* outcome(laptop.client.dispatch(approve));

        const revoked = yield* studio.client["userAccess.revoke"]({ id });
        const after = yield* outcome(laptop.client.dispatch(approve));
        const again = yield* desktopApp(connect, LAPTOP_KEY, "MacBook Pro");

        return {
          before,
          revoked: revoked.label,
          after,
          standing: (yield* now(laptop.client))?.standing,
          againAccess: again.access,
          againStanding: (yield* now(again.client))?.standing,
          left: (yield* now(studio.client))?.enrolled.map((app) => app.label),
        };
      })
    )
  );

  expect(result).toEqual({
    before: "reached",
    revoked: "MacBook Pro",
    after: "UserAccessRequired:dispatch:RespondToApproval",
    standing: "none",
    againAccess: false,
    againStanding: "waiting",
    left: ["Mac Studio"],
  });
});

test("a process with its own key can't allow itself, see who is enrolled, or revoke the Desktop App", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");
        const agent = yield* desktopApp(connect, AGENT_KEY, "Mac Studio");
        const seen = yield* stateWhen(studio.client, (state) => state.requests.length === 1);
        const request = seen?.requests[0]?.id;
        const enrolled = seen?.enrolled[0]?.id;

        if (request === undefined || enrolled === undefined)
          return yield* Effect.die("the enrolled app saw no request");

        const own = yield* now(agent.client);

        return {
          allows: yield* outcome(agent.client["userAccess.allow"]({ id: request })),
          revokes: yield* outcome(agent.client["userAccess.revoke"]({ id: enrolled })),
          denies: yield* outcome(agent.client["userAccess.deny"]({ id: request })),
          sees: [own?.enrolled.length, own?.requests.length],
          approves: yield* outcome(agent.client.dispatch(approve)),
          studioApproves: yield* outcome(studio.client.dispatch(approve)),
        };
      })
    )
  );

  expect(result).toEqual({
    allows: "UserAccessRequired:userAccess.allow",
    revokes: "UserAccessRequired:userAccess.revoke",
    denies: "UserAccessRequired:userAccess.deny",
    sees: [0, 0],
    approves: "UserAccessRequired:dispatch:RespondToApproval",
    studioApproves: "reached",
  });
});

test("a denied request closes, and a request goes when its Desktop App disconnects", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");
        const laptop = yield* desktopApp(connect, LAPTOP_KEY, "MacBook Pro");
        const asked = yield* stateWhen(studio.client, (state) => state.requests.length === 1);
        const id = asked?.requests[0]?.id;

        if (id === undefined) return yield* Effect.die("no request reached the enrolled app");
        yield* studio.client["userAccess.deny"]({ id });
        const denied = (yield* now(laptop.client))?.standing;
        const afterDeny = (yield* now(studio.client))?.requests.length;
        const twice = yield* outcome(studio.client["userAccess.allow"]({ id }));

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* desktopApp(connect, AGENT_KEY, "Passing by");
            yield* stateWhen(studio.client, (state) => state.requests.length === 1);
          })
        );

        const gone = yield* stateWhen(studio.client, (state) => state.requests.length === 0);

        return { denied, afterDeny, twice, gone: gone?.requests.length };
      })
    )
  );

  expect(result).toEqual({ denied: "none", afterDeny: 0, twice: "NotFound:request", gone: 0 });
});

test("a process making up keys fills only so many requests, each with a one-line label", async () => {
  const result = await Effect.runPromise(
    withServer((connect) =>
      Effect.gen(function* () {
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");

        const made = yield* Effect.forEach(
          Array.from({ length: MAX_REQUESTS + 2 }, (_, n) => n),
          (n) => desktopApp(connect, n.toString(16).padStart(64, "1"), `Mac\u001b[2J\nStudio‮ ${n}`)
        );

        const seen = yield* stateWhen(studio.client, (state) => state.requests.length > 0);
        const last = made.at(-1);

        return {
          requests: seen?.requests.length,
          first: seen?.requests[0]?.label,
          overflow: last === undefined ? null : (yield* now(last.client))?.standing,
        };
      })
    )
  );

  expect(result).toEqual({ requests: MAX_REQUESTS, first: "Mac [2J Studio  0", overflow: "none" });
});

test("0.9.0's single enrolment is not kept: the first Desktop App after the upgrade enrols", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        writeFileSync(
          join(root, "user-access.json"),
          JSON.stringify({
            version: 1,
            keys: [{ digest: "0".repeat(64), label: "Old MacBook", enrolledAt: "2026-11-10" }],
          })
        );

        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");

        return { access: studio.access, stored: keysIn(root).map((key) => key.label) };
      })
    )
  );

  expect(result).toEqual({ access: true, stored: ["Mac Studio"] });
});

test("a corrupt enrolment file enrols nobody and opens no request", async () => {
  const result = await Effect.runPromise(
    withServer((connect, root) =>
      Effect.gen(function* () {
        const file = join(root, "user-access.json");
        writeFileSync(file, "{ not json");
        const studio = yield* desktopApp(connect, DESKTOP_KEY, "Mac Studio");

        return {
          access: studio.access,
          standing: (yield* now(studio.client))?.standing,
          approves: yield* outcome(studio.client.dispatch(approve)),
          file: readFileSync(file, "utf8"),
        };
      })
    )
  );

  expect(result).toEqual({
    access: false,
    standing: "none",
    approves: "UserAccessRequired:dispatch:RespondToApproval",
    file: "{ not json",
  });
});
