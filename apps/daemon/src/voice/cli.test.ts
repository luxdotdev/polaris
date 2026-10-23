import { expect, test } from "bun:test";
import { HostSecrets } from "../secrets/index.ts";
import { runVoiceCommand, type VoiceCliIo } from "./cli.ts";

const KEY = "0123456789abcdef0123456789abcdef01234567";

const session = () => {
  const lines: Array<string> = [];
  const secrets = HostSecrets.memory();

  const io = (typed: string | null): VoiceCliIo => ({
    readKey: () => Promise.resolve(typed),
    out: (line) => lines.push(line),
    err: (line) => lines.push(`! ${line}`),
  });

  return {
    lines,
    run: (args: Array<string>, typed: string | null = null) =>
      runVoiceCommand(args, io(typed), secrets),
  };
};

test("set, status and clear manage the key without ever printing it", async () => {
  const cli = session();

  const codes = [
    await cli.run(["key", "status"]),
    await cli.run(["key", "set"], `${KEY}\n`),
    await cli.run(["key", "status"]),
    await cli.run(["key", "clear"]),
    await cli.run(["key", "status"]),
  ];

  expect(codes).toEqual([0, 0, 0, 0, 0]);
  expect(cli.lines).toEqual([
    "Deepgram key: not set",
    "Deepgram key saved in ~/.polaris/secrets",
    "Deepgram key: set, in ~/.polaris/secrets",
    "Deepgram key removed",
    "Deepgram key: not set",
  ]);
});

test("a missing or malformed key is refused with a reason", async () => {
  const cli = session();

  expect(await cli.run(["key", "set"], null)).toBe(2);
  expect(await cli.run(["key", "set"], "not a key")).toBe(1);
  expect(await cli.run(["key", "rotate"])).toBe(2);
  expect(cli.lines).toEqual([
    "! polaris voice key set: no key given",
    "! polaris voice key set: That is not a Deepgram API key: it should be letters and digits only.",
    "! usage: polaris voice key <set|clear|status>",
  ]);
});
