import type { Socket } from "node:net"
import {
  type ByteTransport,
  type EventReadable,
  type EventWritable,
  readEvents,
  writeEvents,
} from "@polaris/protocol"
import { Effect } from "effect"

/**
 * Adapts a connected `node:net` socket to a ByteTransport. Call it in the
 * accept callback itself: its read listener must be attached before the first
 * byte arrives.
 */
export const fromNodeSocket = (socket: Socket): ByteTransport => ({
  incoming: readEvents(socket as unknown as EventReadable),
  write: writeEvents(socket as unknown as EventWritable),
  close: Effect.sync(() => {
    socket.end()
  }),
})
