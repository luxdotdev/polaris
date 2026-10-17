/**
 * How the install flow finds a Windows Host, against a fake `Ssh` that answers as a
 * Windows sshd would (its PowerShell has no `sh`, or Git's MINGW one), and how a file
 * travels to one as base64 lines through the real `runCommand`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { probeHost } from "../remote.ts";
import { Ssh, shellQuote } from "../Ssh.ts";
import { WINDOWS_PROBE_COMMAND } from "./probe.ts";

const WINDOWS_ANSWER =
  "os=windows\r\narch=AMD64\r\nshell=powershell\r\npsversion=5.1.26100.9711\r\n";

/** What PowerShell says when the POSIX probe's `sh` doesn't exist. */
const NO_SH =
  "sh : The term 'sh' is not recognized as the name of a cmdlet, function, script file, or operable program.\r\n";

const fakeSsh = (answer: (command: string) => { code: number; stdout: string; stderr: string }) =>
  Layer.succeed(Ssh, Ssh.of({ exec: (_alias, command) => Effect.succeed(answer(command)) }));

const probeWith = (answer: Parameters<typeof fakeSsh>[0]) =>
  Effect.runPromise(probeHost("pc").pipe(Effect.provide(fakeSsh(answer)), Effect.result));

describe("probeHost on a Windows Host", () => {
  test("asks PowerShell when there is no sh", async () => {
    const result = await probeWith((command) =>
      command === WINDOWS_PROBE_COMMAND
        ? { code: 0, stdout: WINDOWS_ANSWER, stderr: "" }
        : { code: 1, stdout: "", stderr: NO_SH }
    );

    expect(Result.getOrUndefined(result)?.windowsShell).toBe("powershell");
  });

  test("asks PowerShell when sh is Git for Windows'", async () => {
    const result = await probeWith((command) =>
      command === WINDOWS_PROBE_COMMAND
        ? { code: 0, stdout: WINDOWS_ANSWER, stderr: "" }
        : { code: 0, stdout: "os=MINGW64_NT-10.0-26200\narch=x86_64\n", stderr: "" }
    );

    expect(Result.getOrUndefined(result)?.os).toBe("windows");
  });

  test("asks cmd's PowerShell when cmd has no sh", async () => {
    const result = await probeWith((command) =>
      command === WINDOWS_PROBE_COMMAND
        ? { code: 0, stdout: WINDOWS_ANSWER.replace("powershell", "cmd"), stderr: "" }
        : {
            code: 9009,
            stdout: "",
            stderr: "'sh' is not recognized as an internal or external command,\r\n",
          }
    );

    expect(Result.getOrUndefined(result)?.windowsShell).toBe("cmd");
  });

  test("asks PowerShell when Git's sh can't run the POSIX probe", async () => {
    const result = await probeWith((command) =>
      command === WINDOWS_PROBE_COMMAND
        ? { code: 0, stdout: WINDOWS_ANSWER, stderr: "" }
        : { code: 1, stdout: "", stderr: "printf: usage: printf [-v var] format [arguments]\n" }
    );

    expect(Result.getOrUndefined(result)?.windowsShell).toBe("powershell");
  });

  test("a Host that is neither keeps the POSIX probe's error", async () => {
    const result = await probeWith((command) =>
      command === WINDOWS_PROBE_COMMAND
        ? { code: 127, stdout: "", stderr: "sh: powershell: not found" }
        : { code: 2, stdout: "", stderr: "sh: syntax error" }
    );

    expect(Result.isFailure(result) ? result.failure.message : null).toBe(
      "unexpected answer (exit 2): sh: syntax error"
    );
  });
});

const dir = mkdtempSync(join(tmpdir(), "polaris-lines-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("stdin as base64 lines", () => {
  // Ssh.local stands in for the SSH Host through /bin/sh, which Windows lacks (ENG-318).
  test.skipIf(process.platform === "win32")(
    "delivers a file larger than one line, byte for byte",
    async () => {
      const bytes = new Uint8Array(200_000).map((_, i) => (i * 13 + 5) % 256);
      const file = join(dir, "payload.bin");
      writeFileSync(file, bytes);

      const decode = join(dir, "decode.ts");
      writeFileSync(
        decode,
        [
          'import { createHash } from "node:crypto";',
          "const text = await Bun.stdin.text();",
          'const lines = text.split("\\n").filter((line) => line.length > 0);',
          'const bytes = Buffer.concat(lines.map((line) => Buffer.from(line, "base64")));',
          'console.log(lines.length, createHash("sha256").update(bytes).digest("hex"));',
        ].join("\n")
      );

      const result = await Effect.runPromise(
        Ssh.use((ssh) =>
          ssh.exec("local", `${shellQuote(process.execPath)} ${shellQuote(decode)}`, {
            stdinFile: file,
            stdinLines: true,
          })
        ).pipe(Effect.provide(Ssh.local(dir)))
      );

      const [lines, sha256] = result.stdout.trim().split(" ");

      expect(Number(lines)).toBeGreaterThan(1);
      expect(sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  );
});
