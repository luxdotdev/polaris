import { expect, test } from "bun:test";
import { commands, SessionPlacement } from "@polaris/protocol";
import { decodeCommandPayload, parseCommandArguments } from "./arguments.ts";
import { commandHelp, runCommands, type CommandIO } from "./index.ts";

const command = (name: string) => {
  const found = commands.find((c) => c.name === name);

  if (!found) throw new Error(name);

  return found;
};

test("arguments preserve string prompts and decode schema types, defaults and positional values", () => {
  const start = command("session.start");

  const parsed = parseCommandArguments(
    start,
    ["123", "--workspace-id", "ws_a", "--harness=claude", "--attachments", '["att_a"]', "--json"],
    () => "ses_new"
  );

  expect(decodeCommandPayload(start, parsed.values)).toMatchObject({
    sessionId: "ses_new",
    prompt: "123",
    harness: "claude",
    placement: SessionPlacement.cases.InPlace.make({}),
    attachments: ["att_a"],
  });
  expect(parsed.json).toBe(true);
  expect(parseCommandArguments(start, ["null"]).values.prompt).toBe("null");
  const show = command("session.show");
  expect(
    decodeCommandPayload(show, parseCommandArguments(show, ["ses_a", "--turn-limit", "2"]).values)
  ).toMatchObject({ sessionId: "ses_a", turnLimit: 2 });
  expect(() => parseCommandArguments(show, ["ses_a", "--typo", "2"])).toThrow("Unknown flag");
  expect(() =>
    decodeCommandPayload(show, parseCommandArguments(show, ["ses_a", "--turn-limit", "bad"]).values)
  ).toThrow();
});

test("help and usage errors require no Daemon and advertise stable exits", async () => {
  const output: Array<string> = [];

  const io: CommandIO = {
    tty: false,
    stdinTTY: true,
    readStdin: async () => "",
    out: (text) => output.push(text),
    err: (text) => output.push(text),
  };

  expect(await runCommands(["session", "list", "--help"], io)).toBe(0);
  expect(output.join("\n")).toContain("4 unreachable");
  expect(commandHelp()).toContain("constellation");
  expect(await runCommands(["session", "show"], io)).toBe(2);
  expect(await runCommands(["session", "list", "--host", "remote"], io)).toBe(2);
  expect(output.join("\n")).toContain("not yet supported");
});
