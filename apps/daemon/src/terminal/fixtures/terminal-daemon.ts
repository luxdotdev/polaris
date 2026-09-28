/**
 * A miniature Daemon for handoff.test.ts: the real `Terminals` (recorded under
 * `POLARIS_HOME`, handed across upgrades) behind a line protocol on the Daemon
 * socket, and the real upgrade hand-off.
 *
 *   bun terminal-daemon.ts --as <version>
 *
 * Requests (one JSON line each): `{op:"info"}`, `{op:"open",cwd}`,
 * `{op:"input",id,text}`, `{op:"resize",id,cols,rows}`, `{op:"read",id}` (the
 * replay an attacher gets now, as text, with `<exit N>` appended once exited),
 * `{op:"list"}`.
 */
import type { TerminalId } from "@polaris/protocol"
import type { Socket } from "bun"
import { Effect, Fiber, Stream } from "effect"
import { paths } from "../../paths.ts"
import { CommandRunner } from "../../service/CommandRunner.ts"
import {
  adoptListener,
  bindAtomically,
  connectFd,
  listenerFd,
  serveUpgrades,
} from "../../service/upgrade.ts"
import { makeTerminalsWith, type TerminalItem } from "../Terminals.ts"

const version = process.argv[process.argv.indexOf("--as") + 1] ?? "unknown"

const program = Effect.gen(function* () {
  const adopted = yield* adoptListener()
  const terminals = yield* makeTerminalsWith({ stateDir: paths().root })

  const read = (id: string) =>
    Effect.gen(function* () {
      const items: Array<TerminalItem> = []
      const fiber = yield* terminals.attach(id as TerminalId).pipe(
        Stream.runForEach((item) => Effect.sync(() => items.push(item))),
        Effect.forkChild,
      )
      yield* Effect.sleep("150 millis")
      yield* Fiber.interrupt(fiber)
      return items
        .map((i) => (i._tag === "Output" ? new TextDecoder().decode(i.data) : `<exit ${i.code}>`))
        .join("")
    })

  const handle = (request: Record<string, unknown>): Effect.Effect<unknown> => {
    const id = request.id as TerminalId
    switch (request.op) {
      case "info":
        return Effect.succeed({ version, pid: process.pid, adopted: adopted !== null })
      case "open":
        return terminals
          .open({ cwd: request.cwd as string, cols: 80, rows: 24, argv: ["/bin/sh"] })
          .pipe(Effect.orDie)
      case "input":
        return terminals
          .input(id, new TextEncoder().encode(request.text as string))
          .pipe(Effect.as("ok"), Effect.orDie)
      case "resize":
        return terminals
          .resize(id, request.cols as number, request.rows as number)
          .pipe(Effect.as("ok"), Effect.orDie)
      case "read":
        return read(id)
      case "list":
        return terminals.list
      default:
        return Effect.succeed({ error: `unknown op ${String(request.op)}` })
    }
  }

  const handlers = {
    data(socket: Socket, data: Buffer) {
      for (const line of data.toString().split("\n")) {
        if (line.trim() === "") continue
        Effect.runFork(
          handle(JSON.parse(line)).pipe(
            Effect.tap((reply) => Effect.sync(() => socket.write(`${JSON.stringify(reply)}\n`))),
          ),
        )
      }
    },
  }

  const server = yield* bindAtomically(paths().socket, (temporary) =>
    Effect.sync(() => Bun.listen({ unix: temporary, socket: handlers })),
  )
  if (adopted) yield* adopted.drain((fd) => void connectFd(fd, handlers))
  yield* serveUpgrades({ listenerFd: () => listenerFd(server), args: ["serve"] })
  console.log(`ready ${version}`)
  return yield* Effect.never
})

Effect.runFork(program.pipe(Effect.scoped, Effect.provide(CommandRunner.layer)))
