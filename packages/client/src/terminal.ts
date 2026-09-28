/**
 * Terminal output for a Client: `terminal.attachBinary` when the Daemon has
 * `terminal.binary` (raw bytes on the blob channel), else `terminal.attach`
 * (base64 in JSON). Either way the result is the same stream of items.
 */
import type { BlobError, Capability, NotFound, TerminalId } from "@polaris/protocol"
import { Stream } from "effect"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type { ClientBlobs, DaemonClient } from "./rpc.ts"

export type TerminalOutput =
  | { readonly _tag: "Output"; readonly data: Uint8Array }
  | { readonly _tag: "Exit"; readonly code: number | null }

/**
 * Scrollback, then live output; ends after `Exit`. `capabilities` are the
 * Daemon's (a `LiveSession`'s, or `hello`'s): the binary path is used only
 * when they include `terminal.binary`.
 */
export const attachTerminal = (
  connection: {
    readonly client: DaemonClient
    readonly blobs: ClientBlobs
    readonly capabilities: ReadonlyArray<Capability>
  },
  terminalId: TerminalId,
): Stream.Stream<TerminalOutput, NotFound | RpcClientError | BlobError> => {
  if (!connection.capabilities.includes("terminal.binary")) {
    return connection.client["terminal.attach"]({ terminalId })
  }
  // Sequential: `Exit` is handled only after the output blob has ended, even
  // when its JSON frame overtook the blob's last chunks.
  return connection.client["terminal.attachBinary"]({ terminalId }).pipe(
    Stream.flatMap((item) =>
      item._tag === "Exit"
        ? Stream.succeed<TerminalOutput>(item)
        : connection.blobs
            .takeStream(item.blobId, { idleTimeout: false })
            .pipe(Stream.map((data): TerminalOutput => ({ _tag: "Output", data }))),
    ),
  )
}
