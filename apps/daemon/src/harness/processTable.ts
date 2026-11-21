import { readFileSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
import { libcPath } from "../platform/index.ts";

export interface ProcessIdentity {
  readonly parentPid: number;
  readonly started: string;
}

/** Linux stat's comm can contain spaces and parentheses; fields follow its last closing paren. */
export const linuxProcessIdentity = (stat: string): ProcessIdentity => {
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);

  const parentPid = Number(fields[1]);
  const started = fields[19];

  if (!Number.isInteger(parentPid) || parentPid < 0 || !started || !/^\d+$/.test(started))
    throw new Error("invalid /proc stat");

  return { parentPid, started };
};

const open = () =>
  dlopen(libcPath(), {
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  });

let library: ReturnType<typeof open> | undefined;

/** No subprocesses or polling: proc_pidinfo on macOS, procfs on Linux. */
export const processIdentity = (pid: number): ProcessIdentity => {
  if (process.platform === "linux")
    return linuxProcessIdentity(readFileSync(`/proc/${pid}/stat`, "utf8"));

  if (process.platform !== "darwin") throw new Error("process identity unavailable");
  library ??= open();
  // Darwin's proc_bsdinfo contains parent PID at 16 and start timeval at 120/128.
  const buffer = new Uint8Array(136);
  const size = library.symbols.proc_pidinfo(pid, 3, 0, buffer, buffer.byteLength);

  if (size !== buffer.byteLength) throw new Error(`cannot inspect process ${pid}`);
  const view = new DataView(buffer.buffer);

  return {
    parentPid: view.getUint32(16, true),
    started: `${view.getBigUint64(120, true)}:${view.getBigUint64(128, true)}`,
  };
};
