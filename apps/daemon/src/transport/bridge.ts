/**
 * `polaris bridge`: what `ssh <host> polaris bridge` runs. Pipes stdin/stdout
 * to the local Daemon socket byte for byte, with backpressure both ways, and
 * exits when either side closes. Frames pass through untouched; the bridge
 * never parses them.
 *
 * If no Daemon is listening it prints a reason on stderr and exits with
 * BRIDGE_EXIT_NO_DAEMON, which the Client maps to Needs Attention.
 *
 * With agent forwarding on for the Host, ssh sets SSH_AUTH_SOCK for this
 * process; the bridge repoints `~/.polaris/agent.sock` at it, so the Daemon and
 * its Harnesses can use one stable path that survives reconnects.
 */
import { renameSync, statSync, symlinkSync, unlinkSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol"
import { paths } from "../paths.ts"

/** The stable agent socket path on this Host (a symlink to the latest forwarded agent). */
export const agentSocketPath = (): string => join(paths().root, "agent.sock")

const linkForwardedAgent = () => {
  const forwarded = process.env.SSH_AUTH_SOCK
  if (forwarded === undefined || forwarded === agentSocketPath()) return
  try {
    if (!statSync(forwarded).isSocket()) return
    const temp = `${agentSocketPath()}.${process.pid}`
    try {
      unlinkSync(temp)
    } catch {}
    symlinkSync(forwarded, temp)
    renameSync(temp, agentSocketPath())
  } catch {
    // Best effort: agent forwarding is optional.
  }
}

interface Source {
  pause(): unknown
  resume(): unknown
}
interface Sink {
  write(chunk: Uint8Array, callback: () => void): boolean
  once(event: "drain", listener: () => void): unknown
}

/**
 * Forwards chunks into `sink`, pausing `source` while the sink is backed up.
 * Resumes on the write callbacks as well as `drain`, which Bun does not always
 * emit for sockets.
 */
const pipe = (source: Source, sink: Sink) => {
  let inflight = 0
  let paused = false
  const resume = () => {
    if (paused) {
      paused = false
      source.resume()
    }
  }
  return (chunk: Uint8Array) => {
    inflight++
    const ok = sink.write(chunk, () => {
      inflight--
      if (inflight === 0) resume()
    })
    if (!ok && !paused) {
      paused = true
      source.pause()
      sink.once("drain", resume)
    }
  }
}

export const runBridge = (socketPath: string = paths().socket): Promise<number> =>
  new Promise((resolve) => {
    linkForwardedAgent()
    const stdin = process.stdin
    const stdout = process.stdout
    const socket = connect(socketPath)
    let connected = false
    let settled = false
    // Bytes the Client sent before the socket connected.
    let early: Array<Uint8Array> | null = []
    let stdinEnded = false

    const finish = (code: number) => {
      if (settled) return
      settled = true
      stdin.pause()
      stdin.removeAllListeners("data")
      // Let buffered output reach the Client before exiting.
      stdout.write(new Uint8Array(0), () => resolve(code))
    }

    const toSocket = pipe(stdin, socket)
    stdin.on("data", (chunk: Uint8Array) => {
      if (early !== null) early.push(chunk)
      else toSocket(chunk)
    })
    stdin.once("end", () => {
      stdinEnded = true
      if (connected) socket.end()
    })

    socket.once("connect", () => {
      connected = true
      const buffered = early ?? []
      early = null
      for (const chunk of buffered) toSocket(chunk)
      if (stdinEnded) socket.end()
    })

    socket.on("data", pipe(socket, stdout))

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
