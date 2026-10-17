/**
 * When a running Windows process started, from kernel32 (`GetProcessTimes`): with its pid it
 * names that process and no later one. Loaded on first use, Windows only.
 */
import { dlopen, ptr } from "bun:ffi";

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const STILL_ACTIVE = 259;

const open = () =>
  dlopen("kernel32.dll", {
    OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
    GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
    GetProcessTimes: { args: ["u64", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  });

let lib: ReturnType<typeof open> | undefined;

/** `pid`'s creation time as a FILETIME (100 ns ticks), or null if it isn't running. */
export const windowsProcessStart = (pid: number): bigint | null => {
  const k32 = (lib ??= open()).symbols;
  const handle = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);

  if (handle === 0n) return null;

  try {
    const code = new Uint32Array(1);

    if (k32.GetExitCodeProcess(handle, ptr(code)) === 0 || code[0] !== STILL_ACTIVE) return null;
    const times = new BigUint64Array(4);

    const read = k32.GetProcessTimes(
      handle,
      ptr(times, 0),
      ptr(times, 8),
      ptr(times, 16),
      ptr(times, 24)
    );

    return read === 0 ? null : times[0]!;
  } finally {
    k32.CloseHandle(handle);
  }
};
