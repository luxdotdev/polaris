import { InvalidInvite } from "../api/definition.ts";

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);

/**
 * Checks an Invite's relay URL: `wss://`, or `ws://` on a loopback host for a local relay.
 * Absent or null is Polaris Cloud.
 */
export const checkRelayUrl = (
  relayUrl: string | null | undefined
): string | InvalidInvite | null => {
  if (relayUrl === undefined || relayUrl === null) return null;
  const url = URL.parse(relayUrl);

  if (url === null) return new InvalidInvite({ message: `relayUrl isn't a URL: ${relayUrl}` });

  if (url.username !== "" || url.password !== "") {
    return new InvalidInvite({ message: "relayUrl can't carry a username or password." });
  }

  if (url.protocol === "wss:" || (url.protocol === "ws:" && isLoopback(url.hostname))) {
    return relayUrl;
  }

  return new InvalidInvite({
    message: `relayUrl must be wss://, or ws:// on a loopback host; got ${url.protocol}//${url.host}.`,
  });
};
