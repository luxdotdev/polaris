import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { SocketHandler } from "bun";
import { listenPipe, type PipeServer, PipeUnavailable, probePipe } from "./index.ts";
import { WIN32_ERROR } from "./security.ts";
import { asAnonymous, closeHandle, currentUserSid, openClient, securityOf } from "./win32.ts";

const freshName = () => `\\\\.\\pipe\\polaris-test-${randomUUID()}`;

/** Answers every chunk with `echo:` and the chunk. */
const echo: SocketHandler<undefined> = {
  data: (socket, data) => {
    socket.write(`echo:${Buffer.from(data).toString()}`);
  },
};

const roundTrip = (name: string, message: string) =>
  new Promise<string>((resolve, reject) => {
    const client = connect(name);
    client.once("error", reject);
    client.once("connect", () => client.write(message));
    client.once("data", (data) => {
      client.end();
      resolve(data.toString());
    });
  });

/** Opens `name` for reading as the anonymous user: the Win32 error, or 0 when it opened. */
const openAnonymously = (name: string): number =>
  asAnonymous(() => {
    const opened = openClient(name, 0, "read");

    if ("refused" in opened) return opened.refused;
    closeHandle(opened.handle);

    return 0;
  });

const servers: PipeServer[] = [];

const listen = (name: string) => {
  const server = listenPipe(name, echo);
  servers.push(server);

  return server;
};

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

/** SDDL writes the built-in Administrator (RID 500, as GitHub's runners sign in) as `LA`. */
const sddlAlias = (sid: string) => (/^S-1-5-21-[\d-]+-500$/.test(sid) ? "LA" : sid);

const isElevated = () => {
  if (process.platform !== "win32") return false;
  const pipe = freshName();
  const bun = Bun.listen({ unix: pipe, socket: { data: () => {} } });

  try {
    const opened = openClient(pipe);

    if ("refused" in opened) return false;

    try {
      // An elevated token's default owner is Administrators (BA), not the user.
      return securityOf(opened.handle)?.startsWith("O:BA") === true;
    } finally {
      closeHandle(opened.handle);
    }
  } finally {
    bun.stop(true);
  }
};

describe.skipIf(process.platform !== "win32")(
  "the Daemon's pipe (Windows only: named pipes)",
  () => {
    test("serves one client after another", async () => {
      const name = freshName();
      listen(name);

      expect(await roundTrip(name, "one")).toBe("echo:one");
      expect(await roundTrip(name, "two")).toBe("echo:two");
      expect(await roundTrip(name, "three")).toBe("echo:three");
    });

    test("is owned by the user, and only the user may open it", () => {
      const name = freshName();
      listen(name);
      const opened = openClient(name);

      if ("refused" in opened) throw new Error(`cannot open: ${opened.refused}`);

      try {
        const sid = sddlAlias(currentUserSid());
        expect(securityOf(opened.handle)).toBe(`O:${sid}D:P(A;;FA;;;${sid})`);
      } finally {
        closeHandle(opened.handle);
      }
    });

    test("refuses the anonymous user, whom Bun's own pipe lets read", () => {
      const ours = freshName();
      listen(ours);
      const theirs = freshName();
      const bun = Bun.listen({ unix: theirs, socket: { data: () => {} } });

      try {
        expect(openAnonymously(ours)).toBe(WIN32_ERROR.ACCESS_DENIED);
        // The control: libuv's default DACL grants Anonymous read access (ADR 0059).
        expect(openAnonymously(theirs)).toBe(0);
      } finally {
        bun.stop(true);
      }
    });

    test("a second listener on the same name is refused", () => {
      const name = freshName();
      listen(name);

      expect(() => listen(name)).toThrow(PipeUnavailable);
    });

    test("the probe tells nobody from this user's Daemon", () => {
      const name = freshName();

      expect(probePipe(name)).toBe("absent");
      listen(name);
      expect(probePipe(name)).toBe("ours");
    });

    // CI says which it expects, so the elevated case can't skip there, nor run, by accident.
    test.if(process.env.POLARIS_EXPECT_ELEVATED !== undefined)(
      "the session's elevation is what CI expects (POLARIS_EXPECT_ELEVATED)",
      () => {
        expect(isElevated()).toBe(process.env.POLARIS_EXPECT_ELEVATED === "1");
      }
    );

    test.skipIf(!isElevated())(
      "the probe calls a pipe another owner created foreign (needs an elevated session)",
      () => {
        const name = freshName();
        const squatter = Bun.listen({ unix: name, socket: { data: () => {} } });

        try {
          expect(probePipe(name)).toBe("foreign");
        } finally {
          squatter.stop(true);
        }
      }
    );
  }
);
