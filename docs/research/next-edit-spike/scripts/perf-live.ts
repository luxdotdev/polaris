/**
 * perf-live.ts <out> <home> <modelsDir>: the managed path end to end in the real Desktop App and an
 * isolated Daemon, timed. Copy into apps/desktop/scripts/ to run (it imports ./lib). Adapted from the
 * setup work's live e2e. Steps: Settings → model folder → download → verify → tab completion on →
 * first keystroke (cold load) → typing (latency) → the real 15-minute idle unload → keystroke (warm load).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { startSampler } from "@polaris/bench/sampler";
import { APP_DIR, electronBinary, sizeWindow } from "./lib/electron.ts";
import { startDaemon } from "./lib/daemon.ts";
import { MOCK_KEYCHAIN } from "./lib/githubFlow.ts";

const [out = "", home = "", MODELS = ""] = process.argv.slice(2);
const IDLE_WAIT_MS = Number(process.env.PERF_IDLE_WAIT_MS ?? 16 * 60_000);
const userData = join(home, "user-data");
const userHome = join(home, "user-home");
for (const d of [userData, userHome, out]) mkdirSync(d, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ welcomeSeen: true }));

const t0 = performance.now();
const events: Array<Record<string, unknown>> = [];
const mark = (what: string, extra: Record<string, unknown> = {}) => {
  const row = { what, s: Math.round(performance.now() - t0) / 1000, load: loadavg().map((l) => Math.round(l * 100) / 100), ...extra };
  events.push(row);
  console.log(JSON.stringify(row));
  writeFileSync(join(out, "events.json"), JSON.stringify(events, null, 2) + "\n");
};
const MiB = 1024 * 1024;
const report = (s: ReturnType<typeof startSampler>, from: number) => {
  const r = s.report(from, s.now());
  return { cpuAvgPct: Math.round(r.cpuAvgPct * 100) / 100, wakeupsPerSec: r.wakeupsPerSec && Math.round(r.wakeupsPerSec * 10) / 10,
    rssMiB: Math.round(r.rssBytes.max / MiB), footprintMiB: r.footprintBytes && Math.round(r.footprintBytes.max / MiB), processes: r.maxProcesses };
};
const window = async (label: string, ms: number, samplers: Record<string, ReturnType<typeof startSampler>>) => {
  const from = Object.fromEntries(Object.entries(samplers).map(([k, s]) => [k, s.now()]));
  await new Promise((r) => setTimeout(r, ms));
  mark(`window ${label}`, Object.fromEntries(Object.entries(samplers).map(([k, s]) => [k, report(s, from[k]!)])));
};

const daemon = await startDaemon({ home, benchHarness: true, userHome });
const daemonSampler = startSampler({ roots: () => [daemon.pid!], intervalMs: 500 });
const llamaPid = () => Number(Bun.spawnSync(["pgrep", "-f", `${MODELS}/llama-`]).stdout.toString().trim().split("\n")[0]) || null;
const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR, MOCK_KEYCHAIN],
  env: { ...process.env, POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath, POLARIS_DESKTOP_BENCH_HARNESS: "1", POLARIS_DESKTOP_USER_DATA: userData, POLARIS_DESKTOP_HIDDEN: "1" },
});
const appPid = app.process().pid!;
const appSampler = startSampler({ roots: () => [appPid], intervalMs: 500 });
const statusText = (page: Page) => page.getByTestId("managed-status").first().textContent();
const waitStatus = async (page: Page, pattern: RegExp, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = (await statusText(page)) ?? "";
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`status never matched ${pattern}: last "${last}"`);
};

try {
  const page = await app.firstWindow();
  await sizeWindow(app, 1440, 900);
  await page.locator("html").waitFor();
  await page.waitForTimeout(1500);
  const proof = await page.evaluate<string>('window.polaris.request("dev.proofWorkspace", {}).then((r) => { if (!r.ok) throw new Error(r.error.message); return r.value.path; })');
  mkdirSync(join(proof, "src"), { recursive: true });
  writeFileSync(join(proof, "src", "main.ts"), 'export const greet = (name: string) => `Hello, ${name}`;\n\nexport const sum = (xs: number[]) =>\n  xs.reduce((a, b) => a + b, 0);\n\nconst main = () => {\n  console.log(greet("world"));\n};\n\nmain();\n');
  await page.evaluate(`window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: { _tag: "RegisterWorkspace", path: ${JSON.stringify(proof)}, name: "proof" } }).then((r) => { if (!r.ok) throw new Error(r.error.message); })`);
  await page.waitForTimeout(1500);
  await window("before setup (tab completion off)", 30_000, { daemon: daemonSampler, app: appSampler });

  await page.keyboard.press("Meta+Comma");
  await page.getByRole("button", { name: "Editor" }).click();
  await page.locator("#models-dir-local").waitFor({ timeout: 10_000 });
  await page.locator("#models-dir-local").scrollIntoViewIfNeeded();
  await page.locator("#models-dir-local").fill(MODELS);
  await page.locator("#models-dir-local").press("Enter");
  mark("folder set", { status: await waitStatus(page, /Verifying|^Downloaded|^Not downloaded/, 30_000) });
  if (/Verifying/.test((await statusText(page)) ?? "")) mark("verified existing", { status: await waitStatus(page, /^Downloaded|^Not downloaded|didn't/, 5 * 60_000) });

  await page.getByRole("button", { name: /^Download Sweep/ }).click();
  mark("download clicked", { status: await waitStatus(page, /Downloading/, 20_000) });
  mark("verifying", { status: await waitStatus(page, /Verifying|Downloaded|failed|didn't/, 20 * 60_000) });
  mark("downloaded", { status: await waitStatus(page, /^Downloaded/, 5 * 60_000) });

  const enable = page.locator("#enable-tab-completion");
  if ((await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+3");
  await page.keyboard.press("Meta+P");
  await page.getByTestId("finder-input").fill("main");
  await page.getByTestId("finder-item").first().waitFor({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="editor-tab"][aria-selected="true"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await window("tab completion on, server not started", 30_000, { daemon: daemonSampler, app: appSampler });

  const status = page.getByTestId("prediction-status");
  const code = page.locator('[data-testid="editor-code"]:visible .cm-content').first();
  const card = async () => {
    await status.click();
    await page.getByTestId("completion-card").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const text = (await page.getByTestId("completion-card").textContent()) ?? "";
    await page.keyboard.press("Escape");
    return text;
  };
  const untilServing = async (label: string) => {
    const start = performance.now();
    const kinds: string[] = [];
    while (performance.now() - start < 180_000) {
      const kind = (await status.getAttribute("data-kind")) ?? "";
      if (kinds.at(-1) !== kind) kinds.push(kind);
      if (kind === "serving" || kind === "failed") break;
      await page.waitForTimeout(50);
    }
    const servingS = (performance.now() - start) / 1000;
    await page.waitForTimeout(1000);
    const text = await card();
    mark(label, { servingS, kinds, loadTime: /Load time\s*·?\s*([^·]+?)\s*·/.exec(text)?.[1] ?? null, card: text.slice(0, 600), llamaPid: llamaPid() });
  };

  await code.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Enter");
  mark("first keystroke");
  await page.keyboard.type("const answer = 4");
  await untilServing("cold load");

  // Typing with pauses gives the Daemon's own latency samples (the card's p50) and outcome records.
  const edits = ["2;\n", "export const double = (n: number) => n * 2;\n", "export const triple = (n: number) => n * ", "3;\n", "console.log(sum([1, 2, 3]));\n"];
  for (let round = 0; round < 4; round++)
    for (const e of edits) {
      for (const ch of e) await page.keyboard.type(ch, { delay: 60 });
      await page.waitForTimeout(1500);
    }
  mark("after typing", { card: (await card()).slice(0, 600) });
  const pid = llamaPid();
  const llamaSampler = pid ? startSampler({ roots: () => [pid], intervalMs: 500 }) : null;
  await window("serving, idle (no typing)", 60_000, { daemon: daemonSampler, app: appSampler, ...(llamaSampler ? { server: llamaSampler } : {}) });

  mark("waiting for the idle unload", { minutes: IDLE_WAIT_MS / 60_000 });
  const waitStart = performance.now();
  while (performance.now() - waitStart < IDLE_WAIT_MS && llamaPid() !== null) await page.waitForTimeout(5000);
  mark("server gone", { afterS: Math.round(performance.now() - waitStart) / 1000, llamaPid: llamaPid() });
  await window("after unload", 60_000, { daemon: daemonSampler, app: appSampler });

  await code.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.press("Enter");
  mark("keystroke after unload");
  await page.keyboard.type("const again = 1");
  await untilServing("warm load");

  const outcomes = join(userData, "prediction-outcomes.jsonl");
  if (existsSync(outcomes)) writeFileSync(join(out, "prediction-outcomes.jsonl"), readFileSync(outcomes));
} catch (e) {
  console.error(e);
  mark("failed", { error: String(e) });
  process.exitCode = 1;
} finally {
  await app.close();
  await daemon.stop();
}
