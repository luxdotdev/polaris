import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { acquireAppServer, stopAppServer } from "../../harness/codex/AppServer.ts";
import { Terminals, TerminalsLive, TerminalItem } from "../../terminal/Terminals.ts";
import { CommandRunner } from "../CommandRunner.ts";
import { takeHandoff } from "../upgrade.ts";

const home = process.env.POLARIS_HOME;

if (home === undefined) throw new Error("expected an isolated home");

const stateFile = join(home, "codex-app-server.json");

const wrapper = process.env.POLARIS_TEST_CODEX;

const marker = join(home, "codex-envelope");

if (wrapper === undefined) throw new Error("expected a fake Codex binary");

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        if (process.env.POLARIS_TEST_ADOPT === "after") {
          yield* takeHandoff();
          assert.equal(process.env.POLARIS_HANDOFF, undefined);
        }

        const runner = yield* CommandRunner;

        const command = yield* runner.run([
          "/bin/sh",
          "-c",
          "printf '%s' \"${POLARIS_HANDOFF-unset}\"",
        ]);

        assert.equal(command.stdout, "unset");

        const server = yield* acquireAppServer({
          codexPath: wrapper,
          socketPath: join(home, "c.sock"),
          stateFile,
          spawn: true,
          systemdRun: null,
        });

        const conn = yield* server.connect;

        yield* conn.request("initialize", {});

        assert.equal(readFileSync(marker, "utf8"), "unset");

        const terminals = yield* Terminals;

        const id = yield* terminals.open({
          cwd: home,
          cols: 80,
          rows: 24,
          argv: ["/bin/sh", "-c", "printf '%s' \"${POLARIS_HANDOFF-unset}\""],
        });

        const items = yield* terminals.attach(id).pipe(Stream.runCollect);

        const text = items
          .map((item) =>
            TerminalItem.match(item, {
              Output: (output) => new TextDecoder().decode(output.data),
              Exit: () => "",
            })
          )
          .join("");

        assert.equal(text, "unset");
      })
    ).pipe(Effect.provide(CommandRunner.layer), Effect.provide(TerminalsLive))
  );
} finally {
  await Effect.runPromise(stopAppServer({ stateFile }));
}
