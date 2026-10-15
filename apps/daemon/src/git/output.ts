/** Reading a git child's output under a byte limit, so a huge diff or blob is never held whole. */

/**
 * The stream's bytes, or null once they pass `limit`: reading stops there and
 * `onOverflow` runs (to kill git), so at most `limit` bytes plus one chunk are held.
 */
export const readBounded = async (
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void
): Promise<Uint8Array | null> => {
  const chunks: Array<Uint8Array> = [];
  let total = 0;

  for await (const chunk of stream) {
    total += chunk.byteLength;

    if (total > limit) {
      onOverflow();

      return null;
    }

    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

/** Keeps the first `limit` bytes as text and drains the rest, so git never blocks on stderr. */
export const readHead = async (stream: ReadableStream<Uint8Array>, limit: number) => {
  const decoder = new TextDecoder();
  let text = "";
  let kept = 0;

  for await (const chunk of stream) {
    if (kept >= limit) continue;
    const part = chunk.subarray(0, limit - kept);
    kept += part.byteLength;
    text += decoder.decode(part, { stream: true });
  }

  return text + decoder.decode();
};

/** Megabytes for copy: `64 * 1024 * 1024` reads "64 MB". */
export const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
