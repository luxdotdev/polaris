/**
 * The SDK's WebSocket transport, logged: when each socket opens, how much it
 * carried, and how it closed (the gateway's close code, or the socket's error).
 */
import { HostUnreachable, type OpenTransport, webSocketTransport } from "@polaris/sdk";
import { Effect, Stream } from "effect";

/** The first messages each get a line; after that only the totals do. */
const SHOWN_MESSAGES = 12;

const leading = new TextDecoder();

/** The `_tag`s near the start of a message that begins with a JSON frame, e.g. "Chunk Snapshot". */
export const tagsOf = (bytes: Uint8Array) => {
  if (bytes.byteLength < 6 || bytes[4] !== 0) return "";
  const text = leading.decode(bytes.subarray(5, 200));

  return Array.from(text.matchAll(/"_tag":"(\w+)"/g), (match) => match[1]).join(" ");
};

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
    let messages = 0;
    const totals = () => `${received} bytes in, ${sent} out`;

    log(`opening ${url}`);

    return webSocketTransport(url, pairing.hostId).pipe(
      Effect.tapError((error) => Effect.sync(() => log(`couldn't open: ${error.message}`))),
      Effect.map((transport) => {
        log(`opened ${url}`);

        return {
          incoming: transport.incoming.pipe(
            Stream.tap((bytes) =>
              Effect.sync(() => {
                received += bytes.byteLength;
                messages++;

                if (messages <= SHOWN_MESSAGES)
                  log(`message ${messages}: ${bytes.byteLength} bytes ${tagsOf(bytes)}`.trimEnd());
              })
            ),
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
