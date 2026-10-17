/**
 * Command lines for a Windows Host, whose sshd runs every command through its
 * DefaultShell (`powershell -c`, `pwsh -c` or `cmd /c`). Pure.
 *
 * A PowerShell DefaultShell keeps reading the session's stdin itself (as `$input`) while the
 * command runs, so nothing it starts can read stdin reliably. Bytes for a Windows Host travel
 * as base64 lines instead, and the command reads them from `$input` in the shell sshd started
 * (`withLines`); `docs/adr/0063-windows-ssh-hosts.md`.
 */
import { Match } from "effect";

/** How the Host's sshd runs a command line: its DefaultShell. pwsh behaves as PowerShell. */
export type WindowsShell = "powershell" | "cmd";

/** UTF-16LE base64, what `powershell -EncodedCommand` and `Unicode.GetString` take. */
export const encodeScript = (script: string): string =>
  Buffer.from(script, "utf16le").toString("base64");

/** Single-quote `value` for PowerShell. */
export const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** No progress records (CLIXML on stderr), and every error stops the script. */
const PREAMBLE = "$ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'";

/** Prints the error as one plain line on stderr and exits `code`, instead of CLIXML. */
const guarded = (body: string, code = 1) =>
  `try { ${body} } catch { [Console]::Error.WriteLine('polaris: ' + $_.Exception.Message); exit ${code} }`;

/**
 * Runs `script` in a fresh Windows PowerShell. The line is the same in PowerShell, pwsh and
 * cmd.exe, so it runs before the Client knows the Host's shell. It must not read stdin.
 */
export const encodedCommand = (script: string): string =>
  `powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodeScript(
    `${PREAMBLE}; ${guarded(script)}`
  )}`;

/** A script that consumes base64 lines: `begin` once, `process` per line in `$_`, then `end`. */
export interface LineScript {
  readonly begin: string;
  readonly process: string;
  readonly end: string;
}

const blocks = (script: LineScript) =>
  [
    `begin { ${PREAMBLE}; ${guarded(script.begin)} }`,
    `process { if ($_) { ${guarded(script.process)} } }`,
    `end { ${guarded(script.end)} }`,
  ].join(" ");

/**
 * The command line that feeds the session's stdin, as lines, to `script`. Under PowerShell
 * it is `$input` in sshd's own shell; under cmd.exe, a PowerShell reading its raw stdin.
 */
export const withLines = (script: LineScript, shell: WindowsShell): string =>
  Match.value(shell).pipe(
    Match.when(
      "powershell",
      () =>
        `$input | & ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodeScript(blocks(script))}'))))`
    ),
    Match.when("cmd", () =>
      encodedCommand(
        `& { while ($null -ne ($line = [Console]::In.ReadLine())) { $line } } | & { ${blocks(script)} }`
      )
    ),
    Match.exhaustive
  );

/** The most raw bytes per line `encodeLines` writes; base64 makes it 64 KiB. */
export const LINE_BYTES = 48 * 1024;

/** `bytes` as base64 lines of at most `LINE_BYTES` each, every one ending in `\n`. */
export const encodeLines = (bytes: Uint8Array): string => {
  let out = "";

  for (let at = 0; at < bytes.byteLength; at += LINE_BYTES)
    out += `${Buffer.from(bytes.subarray(at, at + LINE_BYTES)).toString("base64")}\n`;

  return out;
};

const XML_ENTITIES = new Map([
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&amp;", "&"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);

/** CLIXML escapes characters as `_xHHHH_` (`_x000D__x000A_` is a line break). */
const unescapeClixml = (text: string) =>
  text
    .replaceAll(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replaceAll(/&(lt|gt|amp|quot|apos);/g, (entity) => XML_ENTITIES.get(entity) ?? entity);

/**
 * stderr as text: a PowerShell writes its error stream as CLIXML (`#< CLIXML` then
 * `<Objs>…`) when another program reads it. Keeps the error strings, drops progress
 * records; anything else passes through unchanged.
 */
export const stripClixml = (stderr: string): string => {
  const at = stderr.indexOf("#< CLIXML");

  if (at < 0) return stderr;
  const before = stderr.slice(0, at);
  const xml = stderr.slice(at + "#< CLIXML".length);

  const errors = [...xml.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((match) => unescapeClixml(match[1] ?? ""))
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

  const after = xml.replace(/^[\s\S]*<\/Objs>/, "");

  return [before.trimEnd(), errors, after.trim()].filter((part) => part.length > 0).join("\n");
};
