/**
 * `polaris bridge`: what `ssh <host> polaris bridge` runs. Pipes stdin/stdout
 * to the local Daemon socket byte for byte, with backpressure both ways, and
 * exits when either side closes. Frames pass through untouched; the bridge
 * never parses them.
 *
 * If no Daemon is listening it prints a reason on stderr and exits with
 * BRIDGE_EXIT_NO_DAEMON, which the Client maps to Needs Attention.
 */
import { connect } from "node:net"
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol"
import { paths } from "../paths.ts"

export const runBridge = (socketPath: string = paths().socket): Promise<number> =>
  new Promise((resolve) => {
    const stdin = process.stdin
    const stdout = process.stdout
    const socket = connect(socketPath)
    let connected = false
    let settled = false

    const finish = (code: number) => {
      if (settled) return
      settled = true
      stdin.pause()
      stdin.removeAllListeners("data")
      // Let buffered output reach the Client before exiting.
      stdout.write(new Uint8Array(0), () => resolve(code))
    }

    socket.once("connect", () => {
      connected = true
      stdin.on("data", (chunk: Uint8Array) => {
        if (!socket.write(chunk)) {
          stdin.pause()
          socket.once("drain", () => stdin.resume())
        }
      })
      stdin.once("end", () => socket.end())
      stdin.resume()
    })

    socket.on("data", (chunk: Uint8Array) => {
      if (!stdout.write(chunk)) {
        socket.pause()
        stdout.once("drain", () => socket.resume())
      }
    })

    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (!connected) {
        process.stderr.write(
          `polaris bridge: no Daemon is running on this Host (nothing listening on ${socketPath}: ${error.code ?? error.message})\n`,
        )
        finish(BRIDGE_EXIT_NO_DAEMON)
      } else {
        process.stderr.write(`polaris bridge: connection to the Daemon failed: ${error.message}\n`)
        finish(1)
      }
    })

    socket.once("close", () => finish(0))
  })
