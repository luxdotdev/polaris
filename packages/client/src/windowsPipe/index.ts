/**
 * The local Daemon's Windows pipe, opened only once its owner is this account: one handle
 * is opened, checked and then handed to Node as the socket, so nothing can swap the server
 * between the check and the first write. See docs/adr/0062-the-desktop-app-checks-the-local-pipes-owner.md.
 */
import { Socket } from "node:net";
import { Effect } from "effect";
import { ConnectFailure } from "../failures.ts";
import { ownerVerdict, PIPE_ERROR, refusedOpen } from "./trust.ts";
import { loadPipeApi, type PipeApi, type PipeHandle } from "./win32.ts";

export { isPipePath, ownerVerdict, PIPE_ERROR, refusedOpen } from "./trust.ts";

export type { PipeApi, PipeHandle, PipeOpened } from "./win32.ts";

/** How long a busy pipe is retried: every instance in use is momentary (ADR 0059). */
const BUSY_RETRIES = 20;

const BUSY_WAIT_MS = 50;

let api: PipeApi | null = null;

const unverifiable = (cause: unknown) =>
  new ConnectFailure({
    kind: "transient",
    reason: "connection-failed",
    detail: `can't check who owns the daemon's pipe: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const realApi = Effect.try({ try: () => (api ??= loadPipeApi()), catch: unverifiable });

const openHandle = (
  pipes: PipeApi,
  path: string,
  installedHome: string | undefined
): Effect.Effect<PipeHandle, ConnectFailure> =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const opened = pipes.open(path);

      if ("handle" in opened) return opened.handle;

      if (opened.refused !== PIPE_ERROR.PIPE_BUSY || attempt >= BUSY_RETRIES)
        return yield* refusedOpen(path, opened.refused, installedHome);
      yield* Effect.sleep(BUSY_WAIT_MS);
    }
  });

/** Opens `path`, refuses a pipe this account doesn't own, and returns that same handle as a socket. */
export const connectOwnedPipe = (
  path: string,
  installedHome?: string,
  pipes?: PipeApi
): Effect.Effect<Socket, ConnectFailure> =>
  Effect.gen(function* () {
    const windows = pipes ?? (yield* realApi);
    const user = yield* Effect.try({ try: () => windows.userSid(), catch: unverifiable });
    const handle = yield* openHandle(windows, path, installedHome);
    const refused = ownerVerdict(path, windows.ownerSid(handle), user);

    if (refused !== null) {
      windows.close(handle);

      return yield* refused;
    }

    const fd = windows.adopt(handle);

    if (fd < 0) {
      windows.close(handle);

      return yield* new ConnectFailure({
        kind: "transient",
        reason: "connection-failed",
        detail: `${path}: libuv refused the pipe handle (${fd})`,
      });
    }

    return new Socket({ fd, readable: true, writable: true });
  });
