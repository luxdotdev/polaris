/**
 * The program behind an npm `.cmd` shim. Neither Bun nor node will hand a `.cmd` an
 * argument holding `"` or `%` (cmd.exe would expand it), and node's `child_process` won't
 * start one at all, so a Harness installed by npm is run by its target instead.
 * See docs/adr/0065-an-npm-shim-runs-by-its-target.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
import { executableOf, findExecutable } from "./executable.ts";

/** A program and the arguments that go before the caller's own. */
export interface Launch {
  readonly program: string;
  readonly args: ReadonlyArray<string>;
}

export interface ShimIo {
  readonly read: (path: string) => string | null;
  readonly exists: (path: string) => boolean;
  /** A bare program name (`node`) on PATH, or null. */
  readonly which: (name: string) => string | null;
}

const liveIo: ShimIo = {
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  exists: existsSync,
  which: (name) => findExecutable(name),
};

/** The command line's tail that runs the program: after its last `&` or `||` outside quotes. */
const commandOf = (line: string): string => {
  let quoted = false;
  let start = 0;

  for (let at = 0; at < line.length; at++) {
    const char = line[at];

    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "&" || char === "|")) start = at + 1;
  }

  return line.slice(start).trimStart().replace(/^@/, "");
};

const tokens = (command: string): Array<string> =>
  [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? "");

/** `%_prog%`, the script's interpreter: the one beside the shim, else its bare name for PATH. */
const interpreterOf = (text: string, dir: string, io: ShimIo): string => {
  const beside = /SET "_prog=%dp0%\\([^"\\%]+)"/i.exec(text)?.[1];

  if (beside !== undefined && io.exists(win32.join(dir, beside))) return win32.join(dir, beside);

  return /SET "_prog=([^"\\%]+)"/i.exec(text)?.[1] ?? "%_prog%";
};

/**
 * `shim`'s target as npm's cmd-shim writes it: `"%dp0%\…\claude.exe" %*`, or
 * `"%_prog%" "%dp0%\…\cli.js" %*` with node beside the shim or on PATH. Null for any other `.cmd`.
 */
export const parseCmdShim = (shim: string, text: string, io: ShimIo): Launch | null => {
  const line = text.split(/\r?\n/).findLast((candidate) => candidate.includes("%*"));

  if (line === undefined) return null;
  const dir = `${win32.dirname(shim)}\\`;
  const interpreter = interpreterOf(text, dir, io);

  const words = tokens(commandOf(line.slice(0, line.lastIndexOf("%*")))).map((word) =>
    word.replaceAll("%~dp0", dir).replaceAll("%dp0%", dir).replaceAll("%_prog%", interpreter)
  );

  const [first, ...args] = words;

  if (first === undefined || words.some((word) => word.includes("%"))) return null;
  const program = win32.isAbsolute(first) ? win32.normalize(first) : io.which(first);

  if (program === null || !io.exists(program)) return null;
  const resolved = args.map((arg) => (win32.isAbsolute(arg) ? win32.normalize(arg) : arg));

  return resolved.every((arg) => !win32.isAbsolute(arg) || io.exists(arg))
    ? { program, args: resolved }
    : null;
};

/**
 * How to start `binary`: itself, or on Windows an npm `.cmd` shim's target. A `.cmd`
 * that isn't npm's is left to the caller's spawn, which refuses what cmd.exe would expand.
 */
export const launchOf = (
  binary: string,
  os: string = process.platform,
  io: ShimIo = liveIo
): Launch => {
  const itself = { program: binary, args: [] };

  if (os !== "win32" || !/\.cmd$/i.test(binary)) return itself;
  const text = io.read(binary);

  return (text === null ? null : parseCmdShim(binary, text, io)) ?? itself;
};

/** `binary` and then `args`, as an argv that starts it. */
export const launchArgv = (binary: string, args: ReadonlyArray<string>): Array<string> => {
  const launch = launchOf(binary);

  return [executableOf(launch.program), ...launch.args, ...args];
};
