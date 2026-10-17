/**
 * The user's real profile directory on Windows, from the process token
 * (`GetUserProfileDirectoryW`), which ignores `USERPROFILE` and `HOME`: the task
 * name follows it, so a redirected home can't claim the real install's task (ADR 0060).
 */
import { dlopen } from "bun:ffi";

const TOKEN_QUERY = 0x0008;

const MAX_PATH_CHARS = 32_768;

const open = () => ({
  kernel32: dlopen("kernel32.dll", {
    GetCurrentProcess: { args: [], returns: "u64" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  }).symbols,
  advapi32: dlopen("advapi32.dll", {
    OpenProcessToken: { args: ["u64", "u32", "ptr"], returns: "i32" },
  }).symbols,
  userenv: dlopen("userenv.dll", {
    GetUserProfileDirectoryW: { args: ["u64", "ptr", "ptr"], returns: "i32" },
  }).symbols,
});

/** This user's profile as Windows registered it, e.g. `C:\Users\lucas`; null off Windows or on failure. */
export const realProfileDirectory = (): string | null => {
  if (process.platform !== "win32") return null;

  try {
    const lib = open();
    const token = new BigUint64Array(1);

    if (!lib.advapi32.OpenProcessToken(lib.kernel32.GetCurrentProcess(), TOKEN_QUERY, token))
      return null;

    try {
      const chars = new Uint16Array(MAX_PATH_CHARS);
      const size = new Uint32Array([MAX_PATH_CHARS]);

      if (!lib.userenv.GetUserProfileDirectoryW(token[0]!, chars, size)) return null;

      // `size` counts the terminating NUL.
      return Buffer.from(chars.buffer, 0, Math.max(0, size[0]! - 1) * 2).toString("utf16le");
    } finally {
      lib.kernel32.CloseHandle(token[0]!);
    }
  } catch {
    return null;
  }
};
