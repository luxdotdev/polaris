import { dlopen, FFIType } from "bun:ffi";
import { Schema } from "effect";
import { libcPath } from "../platform/index.ts";
import type { Socket } from "bun";

const open = () =>
  dlopen(libcPath(), {
    getsockopt: {
      args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  });

let library: ReturnType<typeof open> | undefined;

const hasFd = Schema.is(Schema.Struct({ fd: Schema.Int }));

export interface PeerPidOption {
  readonly level: number;
  readonly option: number;
  readonly size: number;
}

/** LOCAL_PEERPID (SOL_LOCAL) on Darwin; struct ucred via SO_PEERCRED on Linux. */
export const peerPidOption = (platform: string): PeerPidOption => {
  if (platform === "darwin") return { level: 0, option: 2, size: 4 };

  if (platform === "linux") return { level: 1, option: 17, size: 12 };
  throw new Error("Unix peer credentials unavailable");
};

export type GetSocketOption = (
  fd: number,
  level: number,
  option: number,
  value: Int32Array,
  length: Uint32Array
) => number;

export const readPeerPid = (fd: number, platform: string, getsockopt: GetSocketOption): number => {
  const { level, option, size } = peerPidOption(platform);
  const value = new Int32Array(size / 4);
  const length = new Uint32Array([size]);
  const result = getsockopt(fd, level, option, value, length);

  if (result !== 0 || length[0] !== size || value[0]! <= 0)
    throw new Error("cannot read Unix peer PID");

  return value[0]!;
};

export const peerPid = (socket: Socket<unknown>): number => {
  if (!hasFd(socket) || socket.fd < 0) throw new Error("socket has no fd");
  library ??= open();

  return readPeerPid(socket.fd, process.platform, library.symbols.getsockopt);
};
