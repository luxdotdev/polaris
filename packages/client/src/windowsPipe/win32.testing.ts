/**
 * Tests only: pipe servers with a chosen security descriptor, made through koffi so a test
 * owns both ends. A new instance accepts a client before `ConnectNamedPipe` is ever called.
 */
import { createRequire } from "node:module";
import { Socket } from "node:net";
import type * as Koffi from "koffi";
import type { PipeHandle } from "./win32.ts";

const PIPE_ACCESS_DUPLEX_OVERLAPPED = 0x3 | 0x4000_0000;

const PIPE_REJECT_REMOTE_CLIENTS = 0x8;

type Fn<A extends ReadonlyArray<unknown>, R> = (...args: A) => R;

const bind = () => {
  // SAFETY: koffi's own package, as in win32.ts.
  const koffi = createRequire(import.meta.url)("koffi") as typeof Koffi;
  const k32 = koffi.load("kernel32.dll");
  const adv = koffi.load("advapi32.dll");

  // SAFETY: each signature below is the Win32 prototype the declaration names.
  return {
    koffi,
    CreateNamedPipeW: k32.func(
      "void * __stdcall CreateNamedPipeW(const char16_t *name, uint32_t open, uint32_t mode, uint32_t instances, uint32_t out, uint32_t in, uint32_t timeout, void *sa)"
    ) as Fn<[string, number, number, number, number, number, number, Buffer], PipeHandle>,
    GetLastError: k32.func("uint32_t __stdcall GetLastError()") as Fn<[], number>,
    ConvertStringSecurityDescriptorToSecurityDescriptorW: adv.func(
      "int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *sddl, uint32_t revision, _Out_ void **descriptor, void *size)"
    ) as Fn<[string, number, Array<unknown>, null], number>,
    uvOpenOsfhandle: koffi.load(process.execPath).func("int uv_open_osfhandle(void *handle)") as Fn<
      [PipeHandle],
      number
    >,
  };
};

let calls: ReturnType<typeof bind> | null = null;

const win = () => (calls ??= bind());

/** A `SECURITY_ATTRIBUTES` for `sddl`. */
const attributes = (sddl: string): Buffer => {
  const descriptor: Array<unknown> = [null];

  if (!win().ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, descriptor, null))
    throw new Error(`bad SDDL ${sddl} (Win32 error ${win().GetLastError()})`);
  // { DWORD nLength; LPVOID lpSecurityDescriptor; BOOL bInheritHandle } is 24 bytes on x64.
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32LE(24, 0);
  buffer.writeBigUInt64LE(win().koffi.address(descriptor[0]), 8);

  return buffer;
};

export interface PipeInstance {
  /** The server end as a socket, once a client has opened the instance. */
  readonly accept: () => Socket;
}

/** One pipe instance of `name` secured by `sddl`. */
export const servePipe = (name: string, sddl: string): PipeInstance => {
  const handle = win().CreateNamedPipeW(
    name,
    PIPE_ACCESS_DUPLEX_OVERLAPPED,
    PIPE_REJECT_REMOTE_CLIENTS,
    1,
    65_536,
    65_536,
    0,
    attributes(sddl)
  );

  if (win().koffi.address(handle) === 0xffff_ffff_ffff_ffffn)
    throw new Error(`CreateNamedPipeW failed (Win32 error ${win().GetLastError()})`);

  return {
    accept: () => new Socket({ fd: win().uvOpenOsfhandle(handle), readable: true, writable: true }),
  };
};
