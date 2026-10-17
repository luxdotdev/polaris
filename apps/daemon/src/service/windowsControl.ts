/**
 * The Windows Daemon's control pipe: Windows has no SIGTERM to send another
 * process, so `polaris install`, `upgrade` and `uninstall` ask the Daemon to
 * stop through a second user-only, local-only pipe beside its own (ADR 0060).
 * One JSON line each way. Windows only: it loads the pipe's `bun:ffi` bindings.
 */
import type { Socket, SocketHandler } from "bun";
import { windowsPipeName } from "@polaris/protocol/endpoint";
import { Option, Schema } from "effect";
import { listenPipe, type PipeServer } from "../transport/windowsPipe/index.ts";
import {
  closeHandle,
  currentUserSid,
  openClient,
  ownerSidOf,
} from "../transport/windowsPipe/win32.ts";

export const controlPipeName = (polarisHome: string): string =>
  `${windowsPipeName(polarisHome)}-control`;

export const ControlRequest = Schema.Union([
  Schema.Struct({ op: Schema.Literal("status") }),
  /** `upgrade`, `restart` or `uninstall`; the Daemon exits `SERVE_EXIT_STOPPED` after the reply. */
  Schema.Struct({ op: Schema.Literal("stop"), reason: Schema.String }),
]);

export type ControlRequest = typeof ControlRequest.Type;

export const ControlReply = Schema.Struct({ pid: Schema.Int, version: Schema.String });

export type ControlReply = typeof ControlReply.Type;

const decodeRequest = Schema.decodeUnknownOption(Schema.fromJsonString(ControlRequest));

const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(ControlReply));

/** Splits a socket's bytes into lines, calling `line` with each complete one. */
const lineReader = (line: (socket: Socket<undefined>, text: string) => void) => {
  const buffers = new WeakMap<Socket<undefined>, string>();

  return (socket: Socket<undefined>, chunk: Uint8Array) => {
    const text = (buffers.get(socket) ?? "") + new TextDecoder().decode(chunk);
    const end = text.indexOf("\n");

    if (end < 0) {
      buffers.set(socket, text);

      return;
    }

    buffers.delete(socket);
    line(socket, text.slice(0, end));
  };
};

/** Serves the control pipe until stopped. `onStop` runs after the stop's reply is written. */
export const serveControl = (
  polarisHome: string,
  version: string,
  onStop: (reason: string) => void
): PipeServer => {
  const reply = JSON.stringify({ pid: process.pid, version } satisfies ControlReply);

  const handler: SocketHandler<undefined> = {
    data: lineReader((socket, text) => {
      const request = decodeRequest(text);
      socket.end(`${reply}\n`);

      if (Option.isSome(request) && request.value.op === "stop") onStop(request.value.reason);
    }),
  };

  return listenPipe(controlPipeName(polarisHome), handler);
};

/** What answered on the control pipe. */
export type ControlAnswer =
  | { readonly kind: "none" }
  /** A pipe another account created: never sent anything. */
  | { readonly kind: "foreign" }
  | { readonly kind: "reply"; readonly reply: ControlReply };

const NONE: ControlAnswer = { kind: "none" };

/**
 * Sends `request` to this user's Daemon and reads its one-line reply. The pipe's
 * owner is checked on the handle the request then travels over, so no squatter reads it.
 */
export const askDaemon = (
  polarisHome: string,
  request: ControlRequest,
  timeoutMs = 3000
): Promise<ControlAnswer> => {
  const opened = openClient(controlPipeName(polarisHome));

  if ("refused" in opened) return Promise.resolve(NONE);

  if (ownerSidOf(opened.handle) !== currentUserSid()) {
    closeHandle(opened.handle);

    return Promise.resolve({ kind: "foreign" });
  }

  return new Promise<ControlAnswer>((resolve) => {
    const timer = setTimeout(() => resolve(NONE), timeoutMs);

    const settle = (answer: ControlAnswer) => {
      clearTimeout(timer);
      resolve(answer);
    };

    const handler: SocketHandler<undefined> = {
      open: (socket) => void socket.write(`${JSON.stringify(request)}\n`),
      data: lineReader((socket, text) => {
        const reply = decodeReply(text);
        // Settle first: `end` can run `close` synchronously, which would settle with nothing.
        settle(Option.isSome(reply) ? { kind: "reply", reply: reply.value } : NONE);
        socket.end();
      }),
      close: () => settle(NONE),
      error: () => settle(NONE),
    };

    Bun.connect({ fd: Number(opened.handle), socket: handler }).catch(() => settle(NONE));
  });
};
