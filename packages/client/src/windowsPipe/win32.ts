/**
 * The Win32 calls the pipe check needs and Node doesn't expose, through koffi: open a
 * pipe's client end, read its owner and this process's user, and hand the same handle to
 * libuv as a file descriptor (`uv_open_osfhandle`, exported by node.exe and electron.exe).
 * Loaded on first use, Windows only. Decisions: docs/adr/0062-the-desktop-app-checks-the-local-pipes-owner.md.
 */
import { createRequire } from "node:module";
import type * as Koffi from "koffi";
import { CLIENT_OPEN_FLAGS } from "./trust.ts";

/** A koffi `HANDLE`: opaque to everything but these calls. */
export interface PipeHandle {
  readonly __pipeHandle: unique symbol;
}

/** A client end of a pipe, or the Win32 error that refused it. */
export type PipeOpened = { readonly handle: PipeHandle } | { readonly refused: number };

/** What `connectOwnedPipe` needs from Windows; tests replace it. */
export interface PipeApi {
  readonly open: (name: string) => PipeOpened;
  /** The owner SID of the pipe `handle` belongs to; null when Windows won't say. */
  readonly ownerSid: (handle: PipeHandle) => string | null;
  /** This process's user SID (`TokenUser`), the same elevated or not. */
  readonly userSid: () => string;
  /** A descriptor for `handle` that libuv owns from now on (closing it closes the handle). */
  readonly adopt: (handle: PipeHandle) => number;
  readonly close: (handle: PipeHandle) => void;
}

const GENERIC_READ_WRITE = 0xc000_0000;

const OPEN_EXISTING = 3;

const SE_KERNEL_OBJECT = 6;

const OWNER_SECURITY_INFORMATION = 0x1;

const TOKEN_QUERY = 0x8;

const TOKEN_USER = 1;

const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn;

type Fn<A extends ReadonlyArray<unknown>, R> = (...args: A) => R;

const bind = (koffi: typeof Koffi) => {
  const k32 = koffi.load("kernel32.dll");
  const adv = koffi.load("advapi32.dll");

  // SAFETY: each signature below is the Win32 prototype the declaration names.
  return {
    CreateFileW: k32.func(
      "void * __stdcall CreateFileW(const char16_t *name, uint32_t access, uint32_t share, void *sa, uint32_t disposition, uint32_t flags, void *template)"
    ) as Fn<[string, number, number, null, number, number, null], PipeHandle | null>,
    GetLastError: k32.func("uint32_t __stdcall GetLastError()") as Fn<[], number>,
    CloseHandle: k32.func("int __stdcall CloseHandle(void *handle)") as Fn<[PipeHandle], number>,
    LocalFree: k32.func("void * __stdcall LocalFree(void *memory)") as Fn<[unknown], unknown>,
    GetCurrentProcess: k32.func("void * __stdcall GetCurrentProcess()") as Fn<[], PipeHandle>,
    OpenProcessToken: adv.func(
      "int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ void **token)"
    ) as Fn<[PipeHandle, number, Array<PipeHandle | null>], number>,
    GetTokenInformation: adv.func(
      "int __stdcall GetTokenInformation(void *token, int kind, void *info, uint32_t length, _Out_ uint32_t *returned)"
    ) as Fn<[PipeHandle, number, Buffer, number, Array<number>], number>,
    GetSecurityInfo: adv.func(
      "uint32_t __stdcall GetSecurityInfo(void *handle, int type, uint32_t info, _Out_ void **owner, void **group, void **dacl, void **sacl, _Out_ void **descriptor)"
    ) as Fn<[PipeHandle, number, number, Array<unknown>, null, null, null, Array<unknown>], number>,
    ConvertSidToStringSidW: adv.func(
      "int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)"
    ) as Fn<[unknown, Array<unknown>], number>,
    uvOpenOsfhandle: koffi.load(process.execPath).func("int uv_open_osfhandle(void *handle)") as Fn<
      [PipeHandle],
      number
    >,
  };
};

/** A SID that advapi32 handed back: an opaque native pointer, freed with its descriptor. */
interface SidPointer {
  readonly __sidPointer: unique symbol;
}

const sidText = (koffi: typeof Koffi, calls: ReturnType<typeof bind>, sid: SidPointer | null) => {
  const text: Array<unknown> = [null];

  if (!calls.ConvertSidToStringSidW(sid, text)) return null;

  try {
    return koffi.decode.string16(text[0]);
  } finally {
    calls.LocalFree(text[0]);
  }
};

/** The real `PipeApi`; throws when koffi or its native module can't load. */
export const loadPipeApi = (): PipeApi => {
  // SAFETY: koffi's own package, resolved at runtime so bundles keep it external.
  const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
  const calls = bind(koffi);
  let user: string | null = null;

  const readUser = () => {
    const token: Array<PipeHandle | null> = [null];

    if (!calls.OpenProcessToken(calls.GetCurrentProcess(), TOKEN_QUERY, token) || !token[0])
      throw new Error(`OpenProcessToken failed (Win32 error ${calls.GetLastError()})`);

    try {
      const info = Buffer.alloc(512);

      if (!calls.GetTokenInformation(token[0], TOKEN_USER, info, info.length, [0]))
        throw new Error(`GetTokenInformation failed (Win32 error ${calls.GetLastError()})`);
      // TOKEN_USER starts with SID_AND_ATTRIBUTES, whose first field is the SID pointer.
      // SAFETY: a `void *` decode is the opaque pointer koffi returns, or null.
      const pointer = koffi.decode(info, "void *") as SidPointer | null;
      const sid = sidText(koffi, calls, pointer);

      if (sid === null) throw new Error("ConvertSidToStringSidW failed");

      return sid;
    } finally {
      calls.CloseHandle(token[0]);
    }
  };

  return {
    open: (name) => {
      const handle = calls.CreateFileW(
        name,
        GENERIC_READ_WRITE,
        0,
        null,
        OPEN_EXISTING,
        CLIENT_OPEN_FLAGS,
        null
      );

      const code = calls.GetLastError();

      return handle === null || koffi.address(handle) === INVALID_HANDLE
        ? { refused: code }
        : { handle };
    },
    ownerSid: (handle) => {
      const owner: Array<SidPointer | null> = [null];
      const descriptor: Array<unknown> = [null];
      const SI = OWNER_SECURITY_INFORMATION;

      if (calls.GetSecurityInfo(handle, SE_KERNEL_OBJECT, SI, owner, null, null, null, descriptor))
        return null;

      try {
        return sidText(koffi, calls, owner[0] ?? null);
      } finally {
        calls.LocalFree(descriptor[0]);
      }
    },
    userSid: () => (user ??= readUser()),
    adopt: (handle) => calls.uvOpenOsfhandle(handle),
    close: (handle) => {
      calls.CloseHandle(handle);
    },
  };
};
