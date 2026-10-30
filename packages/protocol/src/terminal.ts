/** The Workspace terminal RPCs (one terminal per Workspace, via Bun.Terminal). */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { NotFound } from "./errors.ts";
import { FileError } from "./files.ts";
import { BlobId, TerminalId } from "./ids.ts";

export const TerminalOpen = Rpc.make("terminal.open", {
  payload: {
    cwd: Schema.String,
    cols: Schema.Int,
    rows: Schema.Int,
    /** Command to run instead of the login shell, e.g. a Harness TUI for "Open in terminal". */
    argv: Schema.NullOr(Schema.Array(Schema.String)),
  },
  success: Schema.Struct({ terminalId: TerminalId }),
  error: FileError,
});

/** Output bytes, base64 in JSON. Replays recent scrollback first on attach. */
export const TerminalAttach = Rpc.make("terminal.attach", {
  payload: { terminalId: TerminalId },
  success: Schema.TaggedUnion({
    Output: { data: Schema.Uint8ArrayFromBase64 },
    Exit: { code: Schema.NullOr(Schema.Int) },
  }),
  error: NotFound,
  stream: true,
});

/**
 * `terminal.attach` with the output as raw bytes instead of base64 in JSON
 * (capability `terminal.binary`). The first item names one long-lived blob
 * that carries all the output, scrollback first, as binary side-chunks; take
 * it as a stream (`takeStream`, idle timeout off). It ends when the output
 * does, and `Exit` follows. `Exit` can arrive before the blob's last chunks
 * (JSON frames are never queued behind blob chunks), so wait for the blob to
 * end before acting on it. Ending the stream stops the blob.
 */
export const TerminalAttachBinary = Rpc.make("terminal.attachBinary", {
  payload: { terminalId: TerminalId },
  success: Schema.TaggedUnion({
    Output: { blobId: BlobId },
    Exit: { code: Schema.NullOr(Schema.Int) },
  }),
  error: NotFound,
  stream: true,
});

export const TerminalInput = Rpc.make("terminal.input", {
  payload: { terminalId: TerminalId, data: Schema.Uint8ArrayFromBase64 },
  error: NotFound,
});

export const TerminalResize = Rpc.make("terminal.resize", {
  payload: { terminalId: TerminalId, cols: Schema.Int, rows: Schema.Int },
  error: NotFound,
});

export const TerminalClose = Rpc.make("terminal.close", {
  payload: { terminalId: TerminalId },
  error: NotFound,
});

export class TerminalRpcs extends RpcGroup.make(
  TerminalOpen,
  TerminalAttach,
  TerminalAttachBinary,
  TerminalInput,
  TerminalResize,
  TerminalClose
) {}
