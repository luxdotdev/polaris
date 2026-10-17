/**
 * How the Daemon's Windows pipe is created, as data: the security descriptor
 * and the `CreateNamedPipeW` flags (ADR 0059). Pure, so it is tested anywhere.
 */

const PIPE_ACCESS_DUPLEX = 0x3;

const FILE_FLAG_OVERLAPPED = 0x4000_0000;

const FILE_FLAG_FIRST_PIPE_INSTANCE = 0x0008_0000;

const PIPE_TYPE_BYTE = 0x0;

const PIPE_READMODE_BYTE = 0x0;

const PIPE_WAIT = 0x0;

const PIPE_REJECT_REMOTE_CLIENTS = 0x8;

/** `PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED`, plus `FILE_FLAG_FIRST_PIPE_INSTANCE` for the first. */
export const pipeOpenMode = (first: boolean): number =>
  PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0);

const SECURITY_SQOS_PRESENT = 0x0010_0000;

const SECURITY_IDENTIFICATION = 0x0001_0000;

const SECURITY_LEVEL_MASK = 0x0003_0000;

/**
 * `CreateFileW` flags for a Client's end: overlapped, and a server may only identify
 * the Client, never act as it, so a squatter that answers first gains nothing usable.
 */
export const CLIENT_OPEN_FLAGS =
  FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;

/** Whether open flags let the server impersonate the Client (Windows' default without SQOS). */
export const grantsImpersonation = (flags: number): boolean =>
  (flags & SECURITY_SQOS_PRESENT) === 0 || (flags & SECURITY_LEVEL_MASK) > SECURITY_IDENTIFICATION;

/** A byte stream that never accepts a client from another machine (through SMB). */
export const PIPE_MODE =
  PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;

/** Whether a pipe mode refuses remote clients; the listener only creates such instances. */
export const rejectsRemoteClients = (mode: number): boolean =>
  (mode & PIPE_REJECT_REMOTE_CLIENTS) !== 0;

/**
 * Owned by the user, and only the user may open it: a protected DACL (nothing
 * inherited) with one entry. No Administrators, Everyone, Anonymous or SYSTEM.
 */
export const pipeSecurityDescriptor = (userSid: string): string => {
  if (!/^S-1-\d+(-\d+)+$/.test(userSid)) throw new Error(`not a SID: ${userSid}`);

  return `O:${userSid}D:P(A;;GA;;;${userSid})`;
};

/** `PIPE_UNLIMITED_INSTANCES`. */
export const MAX_INSTANCES = 255;

/** The buffer sizes libuv gives its own pipes. */
export const BUFFER_BYTES = 65_536;

/** Win32 error codes the listener and the probe branch on. */
export const WIN32_ERROR = {
  FILE_NOT_FOUND: 2,
  ACCESS_DENIED: 5,
  PIPE_BUSY: 231,
  NO_DATA: 232,
  PIPE_CONNECTED: 535,
  IO_PENDING: 997,
} as const;
