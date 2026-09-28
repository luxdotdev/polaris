/**
 * Handlers the transport owns (`hello`) and placeholders for every other RPC,
 * so a Daemon is runnable end to end before the store, files, git and terminal
 * modules land. `server.ts` layers real handlers over these.
 */
import {
  type Capability,
  CommandRejected,
  FileError,
  GitError,
  type HostInfo,
  NotFound,
  PROTOCOL_VERSION,
  Sequence,
} from "@polaris/protocol"
import { Effect, Stream } from "effect"
import { ClientCapabilities, DeviceLabel } from "../engine/rpc.ts"
import { BlobChannel } from "../services.ts"
import { ServerRpcs } from "./rpcs.ts"

const notYet = (what: string) => `${what} is not available on this Daemon yet`

const fileError = (path: string, what: string) =>
  new FileError({ path, code: "ENOTSUP", message: notYet(what) })

export const defaultHandlers = (options: {
  readonly hostInfo: HostInfo
  readonly capabilities: ReadonlyArray<Capability>
}) =>
  ServerRpcs.toLayer({
    // Record which device this connection is (for ApprovalResolved.resolvedBy) and
    // what it understands (e.g. whether to send it ItemProgress).
    hello: ({ deviceLabel, capabilities }, { client }) =>
      Effect.sync(() => {
        client.annotate(DeviceLabel, deviceLabel)
        client.annotate(ClientCapabilities, capabilities)
      }).pipe(
        Effect.as({
          host: options.hostInfo,
          protocolVersion: PROTOCOL_VERSION,
          capabilities: options.capabilities,
        }),
      ),

    dispatch: ({ commandId }) =>
      Effect.fail(new CommandRejected({ commandId, reason: notYet("the event store") })),

    // An empty Host: a snapshot at sequence 0, then nothing.
    subscribeHost: () =>
      Stream.concat(
        Stream.fromIterable([
          {
            _tag: "Snapshot" as const,
            sequence: Sequence.make(0),
            workspaces: [],
            worktrees: [],
            sessions: [],
          },
          { _tag: "Synchronized" as const, sequence: Sequence.make(0) },
        ]),
        Stream.never,
      ),

    subscribeSession: ({ sessionId }) =>
      Stream.fail(new NotFound({ what: "session", id: sessionId })),
    "session.terminalCommand": ({ sessionId }) =>
      Effect.fail(new NotFound({ what: "session", id: sessionId })),

    "files.listDir": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.stat": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.read": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.searchPaths": ({ root }) => Effect.fail(fileError(root, "file search")),
    "files.grep": ({ root }) => Effect.fail(fileError(root, "file search")),
    "files.watch": ({ root }) => Stream.fail(fileError(root, "file watching")),

    "git.status": ({ cwd }) => Effect.fail(new GitError({ cwd, message: notYet("git") })),
    "git.diff": ({ cwd }) => Effect.fail(new GitError({ cwd, message: notYet("git") })),

    // Drain the bytes the Client already sent so they don't sit in the connection buffer.
    "attachments.stage": ({ name, blobId }) =>
      Effect.gen(function* () {
        const blobs = yield* BlobChannel
        yield* Effect.ignore(blobs.take(blobId))
        return yield* fileError(name, "attachments")
      }),

    "terminal.open": ({ cwd }) => Effect.fail(fileError(cwd, "terminals")),
    "terminal.attach": ({ terminalId }) =>
      Stream.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.attachBinary": ({ terminalId }) =>
      Stream.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.input": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.resize": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.close": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
  })
