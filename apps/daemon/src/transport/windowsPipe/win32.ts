/**
 * The kernel32 and advapi32 calls the Windows pipe needs and Bun doesn't expose:
 * creating instances with our own security descriptor, waiting for a client on
 * the thread pool, and reading a pipe's owner. Loaded on first use, Windows only.
 */
import { dlopen, JSCallback, ptr, read } from "bun:ffi";
import { BUFFER_BYTES, MAX_INSTANCES, PIPE_MODE, pipeOpenMode, WIN32_ERROR } from "./security.ts";

/** A Win32 `HANDLE`, as Bun's FFI passes a `u64`. */
export type Handle = bigint;

export const INVALID_HANDLE: Handle = 0xffff_ffff_ffff_ffffn;

const open = () => ({
  kernel32: dlopen("kernel32.dll", {
    CreateNamedPipeW: {
      args: ["ptr", "u32", "u32", "u32", "u32", "u32", "u32", "ptr"],
      returns: "u64",
    },
    ConnectNamedPipe: { args: ["u64", "ptr"], returns: "i32" },
    DisconnectNamedPipe: { args: ["u64"], returns: "i32" },
    CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "u64"], returns: "u64" },
    WaitNamedPipeW: { args: ["ptr", "u32"], returns: "i32" },
    CreateEventW: { args: ["ptr", "i32", "i32", "ptr"], returns: "u64" },
    CloseHandle: { args: ["u64"], returns: "i32" },
    CancelIoEx: { args: ["u64", "ptr"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
    GetCurrentProcess: { args: [], returns: "u64" },
    GetCurrentThread: { args: [], returns: "u64" },
    RegisterWaitForSingleObject: {
      args: ["ptr", "u64", "ptr", "ptr", "u32", "u32"],
      returns: "i32",
    },
    UnregisterWaitEx: { args: ["u64", "u64"], returns: "i32" },
    GetOverlappedResult: { args: ["u64", "ptr", "ptr", "i32"], returns: "i32" },
    LocalFree: { args: ["u64"], returns: "u64" },
  }),
  advapi32: dlopen("advapi32.dll", {
    OpenProcessToken: { args: ["u64", "u32", "ptr"], returns: "i32" },
    GetTokenInformation: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    ConvertSidToStringSidW: { args: ["u64", "ptr"], returns: "i32" },
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {
      args: ["ptr", "u32", "ptr", "ptr"],
      returns: "i32",
    },
    GetSecurityInfo: {
      args: ["u64", "u32", "u32", "ptr", "ptr", "ptr", "ptr", "ptr"],
      returns: "u32",
    },
    ConvertSecurityDescriptorToStringSecurityDescriptorW: {
      args: ["u64", "u32", "u32", "ptr", "ptr"],
      returns: "i32",
    },
    ImpersonateAnonymousToken: { args: ["u64"], returns: "i32" },
    RevertToSelf: { args: [], returns: "i32" },
  }),
});

let lib: ReturnType<typeof open> | undefined;

const k32 = () => (lib ??= open()).kernel32.symbols;

const adv = () => (lib ??= open()).advapi32.symbols;

export class Win32Error extends Error {
  constructor(
    readonly call: string,
    readonly code: number
  ) {
    super(`${call} failed (Win32 error ${code})`);
    this.name = "Win32Error";
  }
}

const lastError = (): number => k32().GetLastError();

const wide = (value: string): Buffer => Buffer.from(`${value}\0`, "utf16le");

const readWide = (address: bigint): string => {
  let out = "";

  for (let offset = 0; ; offset += 2) {
    // SAFETY: `address` is a NUL-terminated UTF-16 string the call just returned.
    const unit = read.u16(Number(address), offset);

    if (unit === 0) return out;
    out += String.fromCharCode(unit);
  }
};

const TOKEN_QUERY = 0x0008;

const TOKEN_USER = 1;

/** This process's user SID (`TokenUser`), e.g. `S-1-5-21-…-1001`; the same elevated or not. */
export const currentUserSid = (): string => {
  const token = new BigUint64Array(1);

  if (!adv().OpenProcessToken(k32().GetCurrentProcess(), TOKEN_QUERY, ptr(token)))
    throw new Win32Error("OpenProcessToken", lastError());

  try {
    const info = new BigUint64Array(64);
    const length = new Uint32Array(1);

    if (!adv().GetTokenInformation(token[0]!, TOKEN_USER, ptr(info), info.byteLength, ptr(length)))
      throw new Win32Error("GetTokenInformation", lastError());
    const text = new BigUint64Array(1);

    // TOKEN_USER starts with SID_AND_ATTRIBUTES, whose first field is the SID pointer.
    if (!adv().ConvertSidToStringSidW(info[0]!, ptr(text)))
      throw new Win32Error("ConvertSidToStringSidW", lastError());
    const sid = readWide(text[0]!);
    k32().LocalFree(text[0]!);

    return sid;
  } finally {
    k32().CloseHandle(token[0]!);
  }
};

/** A `SECURITY_ATTRIBUTES` for an SDDL string; the buffer must outlive every call that uses it. */
export const securityAttributes = (sddl: string): BigUint64Array => {
  const descriptor = new BigUint64Array(1);

  if (
    !adv().ConvertStringSecurityDescriptorToSecurityDescriptorW(
      ptr(wide(sddl)),
      1,
      ptr(descriptor),
      null
    )
  )
    throw new Win32Error("ConvertStringSecurityDescriptorToSecurityDescriptorW", lastError());
  // { DWORD nLength; LPVOID lpSecurityDescriptor; BOOL bInheritHandle } is 24 bytes on x64.
  const attributes = new BigUint64Array(3);
  new Uint32Array(attributes.buffer)[0] = attributes.byteLength;
  attributes[1] = descriptor[0]!;

  return attributes;
};

/** One server instance of `name`; the first fails if any process already created the pipe. */
export const createInstance = (
  name: string,
  first: boolean,
  attributes: BigUint64Array
): Handle => {
  const handle = k32().CreateNamedPipeW(
    ptr(wide(name)),
    pipeOpenMode(first),
    PIPE_MODE,
    MAX_INSTANCES,
    BUFFER_BYTES,
    BUFFER_BYTES,
    0,
    ptr(attributes)
  );

  if (handle === INVALID_HANDLE) throw new Win32Error("CreateNamedPipeW", lastError());

  return handle;
};

export const closeHandle = (handle: Handle): void => {
  k32().CloseHandle(handle);
};

export interface Overlapped {
  readonly buffer: BigUint64Array;
  readonly event: Handle;
}

/** An `OVERLAPPED` (32 bytes on x64) whose completion signals a new manual-reset event. */
export const overlapped = (): Overlapped => {
  const event = k32().CreateEventW(null, 1, 0, null);

  if (event === 0n) throw new Win32Error("CreateEventW", lastError());
  const buffer = new BigUint64Array(4);
  buffer[3] = event;

  return { buffer, event };
};

/** `ConnectNamedPipe`: whether a client is already connected, the wait is pending, or the client left. */
export const connectInstance = (
  handle: Handle,
  pending: BigUint64Array
): "connected" | "pending" | "gone" => {
  if (k32().ConnectNamedPipe(handle, ptr(pending))) return "connected";
  const code = lastError();

  if (code === WIN32_ERROR.PIPE_CONNECTED) return "connected";

  if (code === WIN32_ERROR.IO_PENDING) return "pending";

  if (code === WIN32_ERROR.NO_DATA) return "gone";
  throw new Win32Error("ConnectNamedPipe", code);
};

/** Whether the overlapped `ConnectNamedPipe` that signalled succeeded. */
export const connectSucceeded = (handle: Handle, pending: BigUint64Array): boolean =>
  k32().GetOverlappedResult(handle, ptr(pending), ptr(new Uint32Array(1)), 0) !== 0;

export const cancelIo = (handle: Handle, pending: BigUint64Array): void => {
  k32().CancelIoEx(handle, ptr(pending));
};

const WT_EXECUTEONLYONCE = 0x8;

const INFINITE = 0xffff_ffff;

export interface Wait {
  /** Stops waiting; blocks until a callback already running has returned. */
  readonly cancel: () => void;
}

/**
 * Calls `signalled` on the JS thread once `event` is set. A thread-pool wait
 * thread blocks on it, so waiting costs no CPU and no timer.
 */
export const waitFor = (event: Handle, signalled: () => void): Wait => {
  const handle = new BigUint64Array(1);
  let done = false;

  const release = (blocking: boolean) => {
    if (done) return;
    done = true;
    k32().UnregisterWaitEx(handle[0]!, blocking ? INVALID_HANDLE : 0n);
    callback.close();
  };

  const callback = new JSCallback(
    () => {
      if (done) return;
      release(false);
      signalled();
    },
    { args: ["ptr", "bool"], returns: "void", threadsafe: true }
  );

  // SAFETY: a JSCallback made by Bun always has a pointer until it is closed.
  const pointer = callback.ptr as NonNullable<typeof callback.ptr>;

  if (
    !k32().RegisterWaitForSingleObject(
      ptr(handle),
      event,
      pointer,
      null,
      INFINITE,
      WT_EXECUTEONLYONCE
    )
  ) {
    callback.close();
    throw new Win32Error("RegisterWaitForSingleObject", lastError());
  }

  return { cancel: () => release(true) };
};

const GENERIC_READ = 0x8000_0000;

const GENERIC_WRITE = 0x4000_0000;

const OPEN_EXISTING = 3;

const FILE_FLAG_OVERLAPPED = 0x4000_0000;

/** A client end of a pipe, or the Win32 error that refused it. */
export type Opened = { readonly handle: Handle } | { readonly refused: number };

/** A client handle to `name`, or the Win32 error that refused it (`PIPE_BUSY` waits briefly). */
export const openClient = (
  name: string,
  waitMs = 1000,
  access: "read-write" | "read" = "read-write"
): Opened => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const handle = k32().CreateFileW(
      ptr(wide(name)),
      access === "read" ? GENERIC_READ : GENERIC_READ | GENERIC_WRITE,
      0,
      null,
      OPEN_EXISTING,
      FILE_FLAG_OVERLAPPED,
      0n
    );

    if (handle !== INVALID_HANDLE) return { handle };
    const code = lastError();

    if (code !== WIN32_ERROR.PIPE_BUSY || attempt > 0) return { refused: code };
    k32().WaitNamedPipeW(ptr(wide(name)), waitMs);
  }

  return { refused: WIN32_ERROR.PIPE_BUSY };
};

const SE_KERNEL_OBJECT = 6;

const OWNER_SECURITY_INFORMATION = 0x1;

/** The owner SID of the pipe `handle` belongs to; null when it can't be read. */
export const ownerSidOf = (handle: Handle): string | null => {
  const owner = new BigUint64Array(1);
  const descriptor = new BigUint64Array(1);
  const SI = OWNER_SECURITY_INFORMATION;

  if (
    adv().GetSecurityInfo(
      handle,
      SE_KERNEL_OBJECT,
      SI,
      ptr(owner),
      null,
      null,
      null,
      ptr(descriptor)
    ) !== 0
  )
    return null;

  try {
    const text = new BigUint64Array(1);

    if (!adv().ConvertSidToStringSidW(owner[0]!, ptr(text))) return null;
    const sid = readWide(text[0]!);
    k32().LocalFree(text[0]!);

    return sid;
  } finally {
    k32().LocalFree(descriptor[0]!);
  }
};

const DACL_SECURITY_INFORMATION = 0x4;

/** The owner and DACL of the pipe `handle` belongs to, as SDDL; null when they can't be read. */
export const securityOf = (handle: Handle): string | null => {
  const descriptor = new BigUint64Array(1);
  const SI = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;

  if (
    adv().GetSecurityInfo(handle, SE_KERNEL_OBJECT, SI, null, null, null, null, ptr(descriptor)) !==
    0
  )
    return null;

  try {
    const text = new BigUint64Array(1);

    if (
      !adv().ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor[0]!,
        1,
        SI,
        ptr(text),
        null
      )
    )
      return null;
    const sddl = readWide(text[0]!);
    k32().LocalFree(text[0]!);

    return sddl;
  } finally {
    k32().LocalFree(descriptor[0]!);
  }
};

/** Tests only: run `body` on this thread as the anonymous user, as an unauthenticated caller would. */
export const asAnonymous = <A>(body: () => A): A => {
  if (!adv().ImpersonateAnonymousToken(k32().GetCurrentThread()))
    throw new Win32Error("ImpersonateAnonymousToken", lastError());

  try {
    return body();
  } finally {
    adv().RevertToSelf();
  }
};
