/**
 * The Daemon's listener on Windows: a named pipe only this user can open and
 * no other machine can reach (ADR 0059). Bun's own `Bun.listen({ unix })` pipe
 * grants Everyone read access and accepts SMB clients, so the Daemon creates
 * each instance itself and hands a connected one to `Bun.connect({ fd })`.
 */
import type { Socket, SocketHandler } from "bun";
import { pipeSecurityDescriptor, WIN32_ERROR } from "./security.ts";
import {
  cancelIo,
  closeHandle,
  connectInstance,
  connectSucceeded,
  createInstance,
  currentUserSid,
  type Handle,
  openClient,
  overlapped,
  ownerSidOf,
  securityAttributes,
  type Wait,
  waitFor,
  Win32Error,
} from "./win32.ts";

export { pipeSecurityDescriptor } from "./security.ts";

export interface PipeServer {
  /** Stops accepting and closes every open connection. */
  readonly stop: () => void;
}

/** Why the pipe name can't be ours: another process holds it, or something failed. */
export class PipeUnavailable extends Error {
  constructor(
    readonly pipe: string,
    readonly reason: "in-use" | "failed",
    detail: string
  ) {
    super(`cannot listen on ${pipe}: ${detail}`);
    this.name = "PipeUnavailable";
  }
}

interface Pending {
  readonly handle: Handle;
  readonly buffer: BigUint64Array;
  readonly event: Handle;
  wait: Wait | null;
}

declare module "bun" {
  /** On Windows `fd` may be a connected pipe HANDLE (ADR 0059); bun-types lacks this overload. */
  function connect<Data = undefined>(options: FdSocketOptions<Data>): Promise<Socket<Data>>;
}

/** Wraps a connected server handle as a Bun socket; Bun owns the handle from here. */
const adopt = <Data>(handle: Handle, socket: SocketHandler<Data>): Promise<Socket<Data>> =>
  Bun.connect({ fd: Number(handle), socket });

/**
 * Listens on the pipe `name` until `stop`. One instance always waits for the
 * next client; it is replaced as soon as a client takes it.
 */
export const listenPipe = <Data>(name: string, socket: SocketHandler<Data>): PipeServer => {
  const attributes = securityAttributes(pipeSecurityDescriptor(currentUserSid()));
  const live = new Set<Socket<Data>>();
  let pending: Pending | null = null;
  let stopped = false;

  const tracked: SocketHandler<Data> = {
    ...socket,
    open: (each) => {
      live.add(each);
      void socket.open?.(each);
    },
    close: (each, error) => {
      live.delete(each);
      void socket.close?.(each, error);
    },
  };

  const create = (first: boolean): Pending => {
    try {
      const handle = createInstance(name, first, attributes);

      return { handle, ...overlapped(), wait: null };
    } catch (error) {
      if (first && error instanceof Win32Error && error.code === WIN32_ERROR.ACCESS_DENIED)
        throw new PipeUnavailable(name, "in-use", "another process already created this pipe");
      throw new PipeUnavailable(name, "failed", String(error));
    }
  };

  const accepted = (instance: Pending) => {
    closeHandle(instance.event);
    // A client that left at once fails here; the handle is Bun's, and closed with it.
    adopt(instance.handle, tracked).catch(() => {});
  };

  const arm = (instance: Pending) => {
    pending = instance;
    const state = connectInstance(instance.handle, instance.buffer);

    if (state === "pending") {
      instance.wait = waitFor(instance.event, () => settle(instance));

      return;
    }

    if (state === "connected") {
      arm(create(false));
      accepted(instance);

      return;
    }

    // The client connected and left before we looked: reuse nothing, start over.
    closeHandle(instance.event);
    closeHandle(instance.handle);
    arm(create(false));
  };

  function settle(instance: Pending) {
    if (stopped) return;
    const ok = connectSucceeded(instance.handle, instance.buffer);
    arm(create(false));

    if (ok) accepted(instance);
    else {
      closeHandle(instance.event);
      closeHandle(instance.handle);
    }
  }

  arm(create(true));

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;

      if (pending !== null) {
        pending.wait?.cancel();
        cancelIo(pending.handle, pending.buffer);
        closeHandle(pending.event);
        closeHandle(pending.handle);
        pending = null;
      }

      for (const each of live) each.end();
      live.clear();
    },
  };
};

export type PipeProbe = "absent" | "ours" | "foreign";

/**
 * Who answers on `name`: nobody, this user's Daemon, or a pipe another account
 * created first (a squatter Clients must not talk to). Opens and closes one connection.
 */
export const probePipe = (name: string): PipeProbe => {
  const opened = openClient(name);

  if ("refused" in opened)
    return opened.refused === WIN32_ERROR.ACCESS_DENIED ? "foreign" : "absent";

  try {
    return ownerSidOf(opened.handle) === currentUserSid() ? "ours" : "foreign";
  } finally {
    closeHandle(opened.handle);
  }
};
