import type { Socket } from "node:net"
import { type ByteTransport, TransportError } from "@polaris/protocol"
import { Effect, Stream } from "effect"

/** Adapts a connected `node:net` socket (Bun implements it natively) to a ByteTransport. */
export const fromNodeSocket = (socket: Socket): ByteTransport => ({
  incoming: Stream.fromAsyncIterable(
    socket as AsyncIterable<Uint8Array>,
    (cause) => new TransportError({ message: "socket read failed", cause }),
  ),
  write: (bytes) =>
    Effect.callback<void, TransportError>((resume) => {
      if (socket.destroyed || !socket.writable) {
        resume(Effect.fail(new TransportError({ message: "socket closed" })))
        return
      }
      if (socket.write(bytes)) {
        resume(Effect.void)
        return
      }
      const cleanup = () => {
        socket.off("drain", onDrain)
        socket.off("close", onClose)
      }
      const onDrain = () => {
        cleanup()
        resume(Effect.void)
      }
      const onClose = () => {
        cleanup()
        resume(Effect.fail(new TransportError({ message: "socket closed while writing" })))
      }
      socket.on("drain", onDrain)
      socket.on("close", onClose)
      return Effect.sync(cleanup)
    }),
  close: Effect.sync(() => {
    socket.end()
    socket.destroySoon?.()
  }),
})
