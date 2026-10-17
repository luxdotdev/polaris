/**
 * Whether the Client may speak to the Daemon behind a Windows pipe it opened, decided from
 * what the open returned and who owns the pipe. Pure, so every branch is tested on any OS.
 * Decisions: docs/adr/0062-the-desktop-app-checks-the-local-pipes-owner.md.
 */
import { ConnectFailure } from "../failures.ts";
import { localDaemonFailure } from "../localDaemon.ts";

const FILE_FLAG_OVERLAPPED = 0x4000_0000;

const SECURITY_SQOS_PRESENT = 0x0010_0000;

const SECURITY_IDENTIFICATION = 0x0001_0000;

const SECURITY_LEVEL_MASK = 0x0003_0000;

/**
 * `CreateFileW` flags for this Client's end of the pipe: overlapped, and a server that answers
 * before the owner check may identify the Client, never impersonate it (as the Daemon's own).
 */
export const CLIENT_OPEN_FLAGS =
  FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;

/** Whether open flags let the server impersonate the Client (Windows' default without SQOS). */
export const grantsImpersonation = (flags: number): boolean =>
  (flags & SECURITY_SQOS_PRESENT) === 0 || (flags & SECURITY_LEVEL_MASK) > SECURITY_IDENTIFICATION;

/** The Win32 errors `CreateFileW` on a pipe client end branches on. */
export const PIPE_ERROR = {
  FILE_NOT_FOUND: 2,
  ACCESS_DENIED: 5,
  PIPE_BUSY: 231,
} as const;

/** A Windows named pipe path (`\\.\pipe\…`), which only Windows Clients reach. */
export const isPipePath = (path: string): boolean => /^\\\\[.?]\\pipe\\/i.test(path);

/** `ConvertSidToStringSidW`'s form: `S-1-5-21-…-1001`. */
export const isSid = (value: string): boolean => /^S-1-\d+(-\d+)+$/.test(value);

/** Why a pipe the Client couldn't open refused it; `PIPE_BUSY` is retried before this. */
export const refusedOpen = (path: string, code: number, installedHome?: string): ConnectFailure => {
  if (code === PIPE_ERROR.FILE_NOT_FOUND) return localDaemonFailure(path, installedHome);

  // The Daemon's pipe lets only this user open it (ADR 0059); a refusal means someone else's.
  if (code === PIPE_ERROR.ACCESS_DENIED) return untrusted(path, "refuses this account");

  return new ConnectFailure({
    kind: "transient",
    reason: "connection-failed",
    detail: `${path}: ${code === PIPE_ERROR.PIPE_BUSY ? "every instance is busy" : `Win32 error ${code}`}`,
  });
};

const untrusted = (path: string, why: string) =>
  new ConnectFailure({
    kind: "needs-attention",
    reason: "daemon-untrusted",
    detail: `${path} ${why}, so it isn't this account's daemon`,
  });

/**
 * Null when the pipe belongs to `userSid`; otherwise the failure that keeps the
 * Client from writing a byte to it. An unreadable owner is never trusted.
 */
export const ownerVerdict = (
  path: string,
  owner: string | null,
  userSid: string
): ConnectFailure | null => {
  if (!isSid(userSid)) throw new Error(`not a SID: ${userSid}`);

  if (owner === null) return untrusted(path, "has an owner Windows wouldn't tell");

  return owner === userSid ? null : untrusted(path, `is owned by ${owner}`);
};
