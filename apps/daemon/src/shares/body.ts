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

  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();

  if (reader === undefined) return "";
  const chunks: Array<Uint8Array> = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > limit) {
      await discard(reader);

      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
};
