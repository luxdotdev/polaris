/**
 * The Win32 data `windowsNative.ts` passes and reads, as pure functions: the TCP
 * listener table, a job's process list, command lines, environment blocks and the
 * security descriptors of private files. Tested on every Host.
 * See docs/adr/0061-windows-process-trees.md.
 */

export interface Listener {
  readonly port: number;
  readonly pid: number;
}

const LOOPBACK = 0x7f00_0001;

/** `MIB_TCPROW_OWNER_PID`: state, local addr, local port, remote addr, remote port, pid. */
const TCP_ROW_BYTES = 24;

/**
 * The 127.0.0.1 listeners in a `MIB_TCPTABLE_OWNER_PID` that `GetExtendedTcpTable`
 * filled with `TCP_TABLE_OWNER_PID_LISTENER`. Address and port are in network order.
 */
export const parseTcpListeners = (table: DataView): ReadonlyArray<Listener> => {
  const listeners: Array<Listener> = [];
  const count = table.byteLength < 4 ? 0 : table.getUint32(0, true);

  for (let row = 0; row < count; row++) {
    const at = 4 + row * TCP_ROW_BYTES;

    if (at + TCP_ROW_BYTES > table.byteLength) break;
    const address = table.getUint32(at + 4, false);
    const port = table.getUint16(at + 8, false);
    const pid = table.getUint32(at + 20, true);

    if (address === LOOPBACK && port > 0) listeners.push({ port, pid });
  }

  return listeners;
};

/** `JOBOBJECT_BASIC_PROCESS_ID_LIST`: two counts, then a `ULONG_PTR` per pid. */
export const parseJobPids = (list: DataView): ReadonlyArray<number> => {
  const listed = list.byteLength < 8 ? 0 : list.getUint32(4, true);
  const pids: Array<number> = [];

  for (let index = 0; index < listed && 8 + index * 8 + 8 <= list.byteLength; index++)
    pids.push(Number(list.getBigUint64(8 + index * 8, true)));

  return pids;
};

/** One argument as the MSVC runtime (and node, and Rust) splits a command line. */
export const quoteWindowsArg = (arg: string, always = false): string => {
  if (!always && arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;

  for (const char of arg) {
    if (char === "\\") {
      slashes++;
      continue;
    }
    // Backslashes before a quote are doubled, and the quote escaped.

    out += "\\".repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }

  return `${out}${"\\".repeat(slashes * 2)}"`;
};

/** What cmd.exe would expand or mis-split even inside quotes. */
const CMD_UNSAFE = /["%\r\n\0]/;

/** What `CreateProcessW` is given: the program it opens, and the line the program parses. */
export interface CommandLine {
  readonly application: string;
  readonly commandLine: string;
}

/**
 * The `CreateProcessW` command line for `argv`. A `.cmd`/`.bat` runs under `cmd`
 * (`/d /s /v:off /c "…"`, as npm runs scripts); an argument cmd would expand is refused.
 */
export const windowsCommandLine = (argv: ReadonlyArray<string>, cmdExe: string): CommandLine => {
  const [program = ""] = argv;

  if (!/\.(cmd|bat)$/i.test(program))
    return { application: program, commandLine: argv.map((arg) => quoteWindowsArg(arg)).join(" ") };
  const unsafe = argv.find((arg) => CMD_UNSAFE.test(arg));

  if (unsafe !== undefined) throw new Error(`cmd.exe would expand ${JSON.stringify(unsafe)}`);

  return {
    application: cmdExe,
    // Every argument quoted, so `&`, `|`, `<`, `>`, `^` and `(` are never cmd's operators.
    commandLine: `${quoteWindowsArg(cmdExe)} /d /s /v:off /c "${argv.map((arg) => quoteWindowsArg(arg, true)).join(" ")}"`,
  };
};

/** A `CREATE_UNICODE_ENVIRONMENT` block: `name=value` strings, sorted, each and all NUL-ended. */
export const environmentBlock = (env: Readonly<Record<string, string | undefined>>): Buffer => {
  const entries = Object.entries(env)
    .flatMap(([name, value]) =>
      value === undefined || name === "" || name.includes("=") ? [] : [`${name}=${value}`]
    )
    .toSorted((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));

  return Buffer.from(`${entries.map((entry) => `${entry}\0`).join("")}\0`, "utf16le");
};

const isSid = (sid: string) => /^S-1-\d+(-\d+)+$/.test(sid);

/**
 * Owned by `sid` and open to it alone: a protected DACL, nothing inherited, no
 * Administrators or SYSTEM. A directory's entry is inherited by what is made in it.
 */
export const privateSddl = (sid: string, kind: "directory" | "file"): string => {
  if (!isSid(sid)) throw new Error(`not a SID: ${sid}`);

  return `O:${sid}D:P(A;${kind === "directory" ? "OICI" : ""};FA;;;${sid})`;
};
