#!/usr/bin/env bun
/**
 * Proves the relay path on the app itself in the iOS simulator: Hermes and the native
 * libsodium module run the Noise IK vector, then link through a real relay to a real
 * Daemon and call a Client-only RPC. Needs Xcode and CocoaPods; the first build is slow.
 *
 *   bun run --cwd apps/mobile simulator:check [--device "iPhone 17"] [--skip-build]
 */
import { Effect } from "effect";
import { appDir } from "./hermesPaths.ts";
import { launchRelayDaemon, relayProcess } from "./relay.testing.ts";

const MARKER = "POLARIS_NATIVE_CHECK ";

const BUNDLE_ID = "dev.lux.polaris.mobile";

const argument = (name: string): string | null => {
  const at = process.argv.indexOf(name);

  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const device = argument("--device") ?? "iPhone 17";

// Not 8081: other worktrees' Metro may hold it.
const port = Number(argument("--port") ?? "8197");

const env = { ...process.env, LANG: "en_US.UTF-8", CI: "1" };

const run = async (command: Array<string>, extra: Record<string, string> = {}) => {
  console.log(`$ ${command.join(" ")}`);

  const child = Bun.spawn(command, {
    cwd: appDir,
    env: { ...env, ...extra },
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed`);
};

const simulatorId = async (): Promise<string> => {
  const child = Bun.spawn(["xcrun", "simctl", "list", "devices", "available", "-j"], {
    stdout: "pipe",
  });

  // SAFETY: simctl's JSON lists runtimes → devices with these fields.
  const listing = (await new Response(child.stdout).json()) as {
    devices: Record<string, Array<{ name: string; udid: string }>>;
  };

  const found = Object.values(listing.devices)
    .flat()
    .find((d) => d.name === device);

  if (found === undefined) throw new Error(`no available simulator named ${device}`);

  return found.udid;
};

await run(["bun", "scripts/buildSodium.ts"]);

const udid = await simulatorId();

const installed = async () =>
  (await Bun.spawn(["xcrun", "simctl", "get_app_container", udid, BUNDLE_ID], { stdout: "ignore" })
    .exited) === 0;

if (!process.argv.includes("--skip-build"))
  // The debug build looks for Metro on RCT_METRO_PORT; --port and --no-bundler can't be combined.
  await run(["bunx", "expo", "run:ios", "--device", udid, "--no-bundler"], {
    RCT_METRO_PORT: String(port),
  }).catch(async () => {
    // Expo then opens Simulator.app over AppleScript, refused without Automation access.
    if (!(await installed())) throw new Error("expo run:ios failed");
  });

const relay = relayProcess();

await relay.start();

const host = await launchRelayDaemon(relay.url);

let metro: Bun.Subprocess<"ignore", "pipe", "inherit"> | null = null;

try {
  // The link expires in five minutes, so it is made only now that the app is installed.
  const offer = await Effect.runPromise(host.client["devices.link"]());

  metro = Bun.spawn(["bunx", "expo", "start", "--port", String(port), "--clear"], {
    cwd: appDir,
    env: { ...env, EXPO_PUBLIC_POLARIS_NATIVE_CHECK: offer.linkString },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });

  await run(["xcrun", "simctl", "terminate", udid, BUNDLE_ID]).catch(() => undefined);
  await run(["xcrun", "simctl", "launch", udid, BUNDLE_ID]);

  const reader = metro.stdout.getReader();
  const deadline = Date.now() + 5 * 60_000;
  let text = "";
  let line: string | undefined;

  while (line === undefined) {
    if (Date.now() > deadline) throw new Error("the app printed no check within five minutes");
    const { value, done } = await reader.read();

    if (done) throw new Error("Metro exited");
    const chunk = new TextDecoder().decode(value);

    process.stderr.write(chunk);
    text += chunk;
    line = text.split("\n").find((l) => l.includes(MARKER));
  }

  // SAFETY: the probe prints the marker and `JSON.stringify` of its CheckResults.
  const results = JSON.parse(line.slice(line.indexOf(MARKER) + MARKER.length)) as Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;

  for (const result of results)
    console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}: ${result.detail}`);

  process.exitCode = results.length === 4 && results.every((result) => result.ok) ? 0 : 1;
} finally {
  metro?.kill("SIGTERM");
  await host.stop();
  await relay.stop();
}
