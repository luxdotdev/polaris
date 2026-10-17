/**
 * Connecting to this user's Daemon pipe from the Host itself (`polaris bridge`, the CLIs a
 * Harness runs). The pipe's owner is read on the handle the bytes then travel over, so a
 * pipe another account created first is never written to (ADR 0059). Windows only.
 */
import { BunSocketStream, streamHandlers } from "../bunSocket.ts";
import { WIN32_ERROR } from "./security.ts";
import type { Handle, Opened } from "./win32.ts";

/** What answered on the Daemon's pipe name. */
export type OwnPipe =
  | { readonly kind: "connected"; readonly stream: BunSocketStream }
  /** Nothing listens there (or it is busy); `code` is the Win32 error. */
  | { readonly kind: "absent"; readonly code: number }
  /**
   * A pipe this user doesn't own: another account created the name first, or holds
   * it with a DACL that refuses us (`owner` null). Nothing was sent to it.
   */
  | { readonly kind: "untrusted"; readonly owner: string | null; readonly user: string };

/** The Win32 calls `connectOwnPipe` makes; tests replace them. */
export interface PipeCalls {
  readonly openClient: (name: string) => Opened;
  readonly ownerSidOf: (handle: Handle) => string | null;
  readonly currentUserSid: () => string;
  readonly closeHandle: (handle: Handle) => void;
  /** Wraps the connected handle as a stream; it owns the handle from then on. */
  readonly adopt: (handle: Handle) => Promise<BunSocketStream>;
}

const adoptHandle = (handle: Handle): Promise<BunSocketStream> =>
  new Promise((resolve, reject) => {
    Bun.connect({ fd: Number(handle), socket: streamHandlers(resolve) }).catch(reject);
  });

const win32Calls = async (): Promise<PipeCalls> => {
  const win32 = await import("./win32.ts");

  return {
    openClient: (name) => win32.openClient(name),
    ownerSidOf: win32.ownerSidOf,
    currentUserSid: win32.currentUserSid,
    closeHandle: win32.closeHandle,
    adopt: adoptHandle,
  };
};

/** Opens `name`, checks its owner is this user, and only then wraps it as a stream. */
export const connectOwnPipe = async (name: string, calls?: PipeCalls): Promise<OwnPipe> => {
  const api = calls ?? (await win32Calls());
  const user = api.currentUserSid();
  const opened = api.openClient(name);

  if ("refused" in opened) {
    return opened.refused === WIN32_ERROR.ACCESS_DENIED
      ? { kind: "untrusted", owner: null, user }
      : { kind: "absent", code: opened.refused };
  }

  const owner = api.ownerSidOf(opened.handle);

  if (owner !== user) {
    api.closeHandle(opened.handle);

    return { kind: "untrusted", owner, user };
  }

  return { kind: "connected", stream: await api.adopt(opened.handle) };
};

/** The line a refusal prints: whose pipe it is, and that nothing was sent. */
export const untrustedMessage = (name: string, pipe: { owner: string | null; user: string }) =>
  pipe.owner === null
    ? `${name} exists but refuses this user (${pipe.user}): another account holds the Daemon's pipe name; nothing was sent`
    : `${name} is owned by ${pipe.owner}, not this user (${pipe.user}): another account holds the Daemon's pipe name; nothing was sent`;
