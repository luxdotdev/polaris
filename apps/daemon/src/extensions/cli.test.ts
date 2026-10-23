import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePairingString, PairingId } from "@polaris/protocol";
import { localEndpoint } from "@polaris/protocol/endpoint";
import { Option } from "effect";
import { shortTemp } from "../platform/testing.ts";
import { type ExtensionCommand, parseExtensionArgs } from "./cli.ts";

test.each<[ReadonlyArray<string>, ExtensionCommand | string]>([
  [
    ["pair", "--name", "Raycast", "--allow", "read,approve,turn"],
    { kind: "pair", name: "Raycast", grant: ["read", "approve", "turn"] },
  ],
  [
    ["pair", "--allow", "voice", "--name", "Even G2"],
    { kind: "pair", name: "Even G2", grant: ["voice"] },
  ],
  [["list"], { kind: "list" }],
  [["revoke", "pair_1"], { kind: "revoke", id: PairingId.make("pair_1") }],
  [["pair", "--name", "Raycast", "--allow", "read,write"], 'unknown grant "write"'],
  [["pair", "--name", "Raycast"], "--allow is required"],
  [["pair", "--allow", "read"], "--name is required"],
  [["pair", "--name", "Raycast", "--allow", "read", "--force"], "unexpected --force"],
  [["revoke"], "revoke takes one pairing id"],
  [["remove", "pair_1"], 'unknown command "remove"'],
])("polaris extension %j", (args, expected) => {
  expect(parseExtensionArgs(args)).toEqual(expected);
});

const cli = async (main: string, env: Record<string, string | undefined>, args: string[]) => {
  const child = Bun.spawn([process.execPath, main, "extension", ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    code: await child.exited,
    out: await new Response(child.stdout).text(),
    err: await new Response(child.stderr).text(),
  };
};

test("the real CLI pairs, lists and revokes through an isolated Daemon", async () => {
  const home = mkdtempSync(shortTemp("polaris-ext-cli-"));
  const main = resolve(import.meta.dir, "../main.ts");

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, "codex"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    POLARIS_HOME: home,
    POLARIS_HOST_SOCKET: localEndpoint(home),
    POLARIS_BENCH_HARNESS: "1",
    POLARIS_SESSION_ID: undefined,
    POLARIS_BINARY: undefined,
  };

  const daemon = Bun.spawn([process.execPath, main, "serve", "--foreground"], {
    env,
    stdout: "pipe",
    stderr: "ignore",
  });

  try {
    const reader = daemon.stdout.getReader();
    let logs = "";

    while (!logs.includes("Daemon listening on")) {
      const chunk = await reader.read();

      if (chunk.done) throw new Error(`Daemon stopped: ${logs}`);
      logs += new TextDecoder().decode(chunk.value);
    }

    reader.releaseLock();

    const paired = await cli(main, env, ["pair", "--name", "Raycast", "--allow", "read,approve"]);
    expect(paired.code).toBe(0);
    const pairingString = paired.out.trim().split("\n").at(-1) ?? "";
    const payload = Option.getOrThrow(decodePairingString(pairingString));
    expect(payload).toMatchObject({ name: "Raycast", url: null });
    expect(payload.token).toMatch(/^pol_ext_/);

    const id = /\((pair_[^)]+)\)/.exec(paired.out)?.[1] ?? "";
    const listed = await cli(main, env, ["list"]);
    expect(listed.out).toContain(`${id}  ·  Raycast  ·  read, approve  ·  not used yet`);

    expect((await cli(main, env, ["revoke", id])).out).toContain(`Revoked Raycast (${id}).`);
    expect((await cli(main, env, ["list"])).out).toMatch(new RegExp(`${id}.*revoked `));

    const missing = await cli(main, env, ["revoke", "pair_nope"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no pairing pair_nope on this host");
  } finally {
    daemon.kill("SIGTERM");
    await daemon.exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
