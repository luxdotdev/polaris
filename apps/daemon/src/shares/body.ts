/**
 * What the Host reads of an issuer's answer (ADR 0112): only an answer from the issuer's own
 * origin, and only up to a byte limit, so no Account Server can make the Daemon buffer more.
 */

/** Whether `response` came from `issuer` itself rather than through a redirect. */
export const fromIssuer = (response: Response, issuer: string): boolean => {
  if (response.redirected) return false;

  // A response made in process has no URL; one off the network names where it came from.
  if (response.url === "") return true;

  return URL.canParse(response.url) && new URL(response.url).origin === issuer;
};

const discard = async (body: { cancel: () => Promise<void> } | null | undefined) => {
  try {
    await body?.cancel();
  } catch {
    // The body is abandoned either way.
  }
};

/** The body as text, or null once it passes `limit` bytes; the rest is never read. */
export const readCapped = async (response: Response, limit: number): Promise<string | null> => {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    await discard(response.body);

    return null;
  }

  const body: AsyncIterable<Uint8Array> | null = response.body;

  if (body === null) return "";
  const chunks: Array<Uint8Array> = [];
  let size = 0;

  // Leaving the loop early cancels the stream: nothing past the limit is pulled.
  for await (const chunk of body) {
    size += chunk.byteLength;

    if (size > limit) return null;
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};
