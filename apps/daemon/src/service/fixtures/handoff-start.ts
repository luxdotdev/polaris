import { strict as assert } from "node:assert";
import { closeSync, fstatSync, openSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { clearCloseOnExec, closeFd, isCloseOnExec, setCloseOnExec, socketPair } from "../libc.ts";
import { adoptListener, listenerFd, takeHandoff } from "../upgrade.ts";
import { startServer } from "../../transport/server.ts";

const mode = process.argv[2];

const home = process.env.POLARIS_HOME;

if (home === undefined) throw new Error("expected an isolated home");

const file = openSync(join(home, "keep"), "w+");

const pair = socketPair();

const listener = Bun.listen({ unix: join(home, "owned.sock"), socket: { data() {} } });

clearCloseOnExec(file);

clearCloseOnExec(pair[0]);

const fd = listenerFd(listener);

const byMode = new Map([
  ["closed", 999_999],
  ["stdio", 1],
  ["file", file],
  ["cloexec", file],
  ["connected", pair[0]],
]);

clearCloseOnExec(fd);

if (mode === "cloexec") setCloseOnExec(file);

process.env.POLARIS_HANDOFF = JSON.stringify({
  listenerFd: byMode.get(mode ?? "") ?? fd,
  fds: mode === "children" ? { "terminal:missing": 999_999 } : {},
  children: {},
  fromVersion: "0.0.0-test",
  requestId: "invalid-envelope",
  ownerPid: mode === "foreign" ? process.pid + 1 : process.pid,
});

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        assert.equal(yield* adoptListener(), null);

        assert.equal(yield* takeHandoff(), null);

        assert.equal(process.env.POLARIS_HANDOFF, undefined);

        assert.equal(isCloseOnExec(file), mode === "cloexec");

        assert.equal(isCloseOnExec(pair[0]), false);

        fstatSync(file);

        const server = yield* startServer({ upgrades: true });

        yield* Effect.promise(() =>
          Bun.connect({
            unix: server.socketPath,
            socket: {
              open(socket) {
                socket.end();
              },
              data() {},
            },
          })
        );

        yield* Effect.sleep(600);

        fstatSync(file);
      })
    )
  );
} finally {
  listener.stop(true);

  closeSync(file);

  closeFd(pair[0]);

  closeFd(pair[1]);
}
