import { PredictionError } from "@polaris/protocol";

const oversized = () =>
  new PredictionError({ reason: "invalid-response", message: "Completion record exceeds limit" });

class RecordDecoder {
  private data: string[] = [];
  private size = 0;

  constructor(private readonly ollama: boolean) {}

  line(raw: string): string | null {
    const line = raw.replace(/\r$/, "");

    if (this.ollama) return line.trim() ? line : null;

    if (line.startsWith("data:")) {
      this.size += line.length;

      if (this.size > 1_048_576) throw oversized();
      this.data.push(line.slice(5).replace(/^ /, ""));
    }

    return line === "" ? this.flush() : null;
  }

  flush(): string | null {
    const result = this.data.length ? this.data.join("\n") : null;
    this.data = [];
    this.size = 0;

    return result;
  }
}

/** Reads records across arbitrary UTF-8 transport boundaries; abort also releases a pending read. */
export async function* records(
  body: ReadableStream<Uint8Array>,
  ollama: boolean,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const reader = body.getReader();

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };

  signal.addEventListener("abort", onAbort, { once: true });

  const decoder = new TextDecoder();
  const records = new RecordDecoder(ollama);
  let pending = "";

  try {
    while (true) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });

      if (pending.length > 1_048_576) throw oversized();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      if (next.done && pending) lines.push(pending);

      for (const line of lines) {
        const record = records.line(line);

        if (record !== null) yield record;
      }

      if (!next.done) continue;
      const last = records.flush();

      if (last !== null) yield last;

      return;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
