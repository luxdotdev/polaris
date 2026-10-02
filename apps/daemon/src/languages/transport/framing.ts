import { LanguageError, LanguageJsonRpcEnvelope } from "@polaris/protocol";
import { Schema } from "effect";

export const messageBytes = 1048576;

export const headerBytes = 8192;

export const failure = (reason: LanguageError["reason"], message: string) =>
  new LanguageError({ reason, message, retryable: false });

/** Incremental byte framing: length limits are enforced before allocating or parsing a body. */
export class LspFramer {
  private buffer = Buffer.alloc(0);
  private length: number | null = null;
  private failed = false;

  constructor(private readonly maximum = messageBytes) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > messageBytes)
      throw failure("invalid-input", "Invalid message limit");
  }

  push(chunk: Uint8Array): LanguageJsonRpcEnvelope[] {
    if (this.failed) throw failure("server-failed", "Framer already failed");

    try {
      return this.consume(chunk);
    } catch (error) {
      this.failed = true;
      this.buffer = Buffer.alloc(0);
      throw error;
    }
  }

  private consume(chunk: Uint8Array): LanguageJsonRpcEnvelope[] {
    const messages: LanguageJsonRpcEnvelope[] = [];

    // Feed bounded slices even when the pipe delivers many frames in one read.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, offset + 4096)]);
      this.drain(messages);
    }

    return messages;
  }

  private drain(messages: LanguageJsonRpcEnvelope[]) {
    while (true) {
      if (this.length === null && !this.readHeader()) return;

      if (this.buffer.length < this.length!) return;
      const body = this.buffer.subarray(0, this.length!);
      this.buffer = this.buffer.subarray(this.length!);
      this.length = null;

      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        messages.push(Schema.decodeUnknownSync(LanguageJsonRpcEnvelope)(JSON.parse(text)));
      } catch {
        throw failure("invalid-input", "Invalid LSP JSON-RPC message");
      }

      if (messages.length > 256) throw failure("queue-full", "Too many frames in one read");
    }
  }

  private readHeader(): boolean {
    const end = this.buffer.indexOf("\r\n\r\n");

    if (end === -1) {
      if (this.buffer.length > headerBytes) throw failure("too-large", "LSP header exceeds limit");

      return false;
    }

    if (end > headerBytes) throw failure("too-large", "LSP header exceeds limit");
    this.length = this.parseHeader(this.buffer.subarray(0, end).toString("latin1"));
    this.buffer = this.buffer.subarray(end + 4);

    return true;
  }

  private parseHeader(header: string): number {
    if (Array.from(header).some((character) => character.charCodeAt(0) > 127))
      throw failure("invalid-input", "Expected ASCII LSP header");
    const lengths: string[] = [];

    for (const line of header.split("\r\n")) {
      const match = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);

      if (match === null) throw failure("invalid-input", "Malformed LSP header");

      if (match[1]!.toLowerCase() === "content-length") lengths.push(match[2]!);

      if (match[1]!.toLowerCase() === "content-type" && !/charset=utf-?8/i.test(match[2]!))
        throw failure("invalid-input", "Unsupported LSP encoding");
    }

    if (lengths.length !== 1 || !/^[0-9]+$/.test(lengths[0]!))
      throw failure("invalid-input", "Expected one Content-Length");
    const length = Number(lengths[0]);

    if (!Number.isSafeInteger(length) || length < 1 || length > this.maximum)
      throw failure("too-large", "LSP body exceeds limit");

    return length;
  }

  end() {
    if (this.buffer.length !== 0 || this.length !== null)
      throw failure("invalid-input", "Truncated LSP frame");
  }
}

export function encodeFrame(message: LanguageJsonRpcEnvelope): Uint8Array {
  const valid = Schema.decodeUnknownSync(LanguageJsonRpcEnvelope)(message);
  const body = Buffer.from(JSON.stringify(valid), "utf8");

  if (body.length > messageBytes) throw failure("too-large", "LSP body exceeds limit");

  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
