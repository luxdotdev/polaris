/**
 * The SDK's WebSocket transport, logged: when each socket opens, how much it
 * carried, and how it closed (the gateway's close code, or the socket's error).
 */
import { HostUnreachable, type OpenTransport, webSocketTransport } from "@polaris/sdk";
import { Effect, Stream } from "effect";

export const loggedTransport =
  (log: (line: string) => void): OpenTransport =>
  (pairing) => {
    const url = pairing.url;

    if (url === null)
      return Effect.fail(
        new HostUnreachable({ hostId: pairing.hostId, detail: "a local pairing needs Node or Bun" })
      );
    let received = 0;
    let sent = 0;
    const totals = () => `${received} bytes in, ${sent} out`;

    log(`opening ${url}`);

    return webSocketTransport(url, pairing.hostId).pipe(
      Effect.tapError((error) => Effect.sync(() => log(`couldn't open: ${error.message}`))),
      Effect.map((transport) => {
        log(`opened ${url}`);

        return {
          incoming: transport.incoming.pipe(
            Stream.tap((bytes) => Effect.sync(() => (received += bytes.byteLength))),
            Stream.tapError((error) =>
              Effect.sync(() => log(`socket failed: ${error.message}; ${totals()}`))
            ),
            Stream.onEnd(Effect.sync(() => log(`socket closed normally; ${totals()}`)))
          ),
          write: (bytes: Uint8Array) =>
            transport.write(bytes).pipe(
              Effect.tap(() => Effect.sync(() => (sent += bytes.byteLength))),
              Effect.tapError((error) => Effect.sync(() => log(`write failed: ${error.message}`)))
            ),
          close: Effect.sync(() => log(`closing the socket; ${totals()}`)).pipe(
            Effect.andThen(transport.close)
          ),
        };
      })
    );
  };
