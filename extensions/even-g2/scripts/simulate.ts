/**
 * A smoke run in the Even Hub simulator: a throwaway Daemon from source with
 * the bench Harness, the app on Vite paired to its gateway, and the simulator
 * driven through its automation API. Screenshots land in build/simulator/.
 *
 *   bun run simulate            # opens the simulator's window for about a minute
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPolaris } from "@polaris/sdk";
import { launchDaemon } from "../../../packages/sdk/src/daemon.testing.ts";

const root = join(import.meta.dir, "..");

const out = join(root, "build", "simulator");

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port ?? 0;

  void probe.stop(true);

  return port;
};

const waitFor = async (what: string, check: () => Promise<boolean>, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`${what} never became ready`);
    await Bun.sleep(250);
  }
};

const daemon = await launchDaemon();

const children: Array<ReturnType<typeof Bun.spawn>> = [];

try {
  const workspaceId = await daemon.registerWorkspace();
  const grant = ["read", "approve", "turn", "start", "voice"] as const;

  const admin = await createPolaris({
    pairings: [await daemon.pair("Admin", grant, "gateway")],
    clientName: "simulate",
  });

  const pairing = await daemon.pair("Even G2", grant, "gateway");

  const start = (script: Record<string, number>) =>
    admin.startSession(daemon.hostId, {
      workspaceId,
      harness: "claude",
      prompt: `bench:${JSON.stringify(script)}`,
    });

  await start({ items: 1, deltaIntervalMs: 0 });
  await start({ items: 3, deltaIntervalMs: 2000 });

  const vitePort = freePort();
  const automation = freePort();
  const api = `http://127.0.0.1:${automation}/api`;

  children.push(
    Bun.spawn(["bunx", "vite", "--port", String(vitePort)], {
      cwd: root,
      env: { ...process.env, VITE_POLARIS_PAIRING: pairing },
      stdio: ["ignore", "ignore", "inherit"],
    })
  );
  await waitFor("Vite", async () => (await fetch(`http://127.0.0.1:${vitePort}/`)).ok);
  children.push(
    Bun.spawn(
      [
        "bunx",
        "evenhub-simulator",
        "--no-glow",
        "--automation-port",
        String(automation),
        `http://127.0.0.1:${vitePort}/`,
      ],
      { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
    )
  );
  await waitFor("the simulator", async () => (await fetch(`${api}/ping`)).ok);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const shot = async (name: string) => {
    await Bun.sleep(1500);
    await Bun.write(join(out, `${name}.png`), await fetch(`${api}/screenshot/glasses`));
    console.log(`${name}.png`);
  };

  const input = (action: string) =>
    fetch(`${api}/input`, {
      method: "POST",
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
    });

  await Bun.sleep(4000);
  await shot("01-sessions");
  await start({ items: 1, approvalEvery: 1, deltaIntervalMs: 0 });
  await shot("02-approval-jumps");
  await input("click");
  await shot("03-actions");
  await input("click");
  await shot("04-approved");
  await input("long_press");
  await shot("05-listening");
  await input("long_press_release");
  await shot("06-voice-outcome");
  await input("double_click");
  await shot("07-session");
  await input("double_click");
  await shot("08-sessions");
  await Bun.write(join(out, "phone.png"), await fetch(`${api}/screenshot/webview`));
  await Bun.write(join(out, "console.json"), await fetch(`${api}/console`));
  await admin.close();
} finally {
  for (const child of children) child.kill();
  // bunx's launcher leaves the simulator's own binary running.
  Bun.spawnSync(["pkill", "-f", "evenhub-simulator --no-glow --automation-port"]);
  await daemon.stop();
}
