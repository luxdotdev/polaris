#!/usr/bin/env node
/**
 * The Editor's budgets (spec §7) and behaviour on the `#editor/...` preview
 * (in-memory files, no Daemon; the Daemon's read cost is M3-FILES' `editor`
 * bench scenario):
 *  - opening a 1 MB file: renderer time from openFile to the first painted lines;
 *  - typing: key-to-paint latency in a small and the 1 MB file, with and without vim;
 *  - 20 open tabs: the app's memory against an empty editor;
 *  - ⌘S and vim's :w save, and ⌘S still saves from vim's insert mode.
 *
 *   node scripts/editorBench.ts [--build] [--json <path>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { APP_DIR, electronBinary } from "./lib/electron.ts";

const args = process.argv.slice(2);

const jsonAt = args.indexOf("--json");

const jsonOut = jsonAt === -1 ? null : (args[jsonAt + 1] ?? null);

if (args.includes("--build")) {
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });
}

const log = (m: string) => console.log(`editor-bench: ${m}`);

const ROOT = "/Users/lucas/code/polaris";

const SMALL = `${ROOT}/daemon/src/hosts/reconnect.ts`;

const BIG = `${ROOT}/bench/big.ts`;

const KEY_LATENCY = `(() => {
  const lat = [];
  const onKey = (e) => {
    const t = e.timeStamp;
    requestAnimationFrame(() => setTimeout(() => lat.push(performance.now() - t), 0));
  };
  document.addEventListener("keydown", onKey, { capture: true });
  window.__keys = { stop: () => { document.removeEventListener("keydown", onKey, { capture: true }); return lat; } };
})()`;

/** The display's frame interval: the median rAF gap while idle. */
const FRAME = `new Promise((resolve) => {
  const gaps = [];
  let last = performance.now();
  const tick = (now) => {
    gaps.push(now - last);
    last = now;
    if (gaps.length < 90) requestAnimationFrame(tick);
    else resolve(gaps.sort((a, b) => a - b)[45]);
  };
  requestAnimationFrame(tick);
})`;

const TYPED = "const retries = attempts.filter((a) => a.ok).length; // count the successes";

interface Result {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly budget: number | null;
}

const results: Array<Result> = [];

const record = (name: string, value: number, unit: string, budget: number | null) => {
  results.push({ name, value, unit, budget });
  const verdict = budget === null ? "" : value <= budget ? " ok" : ` OVER (budget ${budget})`;

  log(`${name}: ${value.toFixed(1)} ${unit}${verdict}`);
};

const quantile = (values: ReadonlyArray<number>, q: number) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

const ready = (page: Page) =>
  page
    .evaluate<boolean>(`document.readyState === "complete" && "__polarisEditor" in window`)
    .catch(() => false);

const scene = async (page: Page, name: string) => {
  await page.evaluate(`window.__polarisEditor = undefined; delete window.__polarisEditor`);
  await page
    .evaluate(`location.hash = "#editor/${name}"; location.reload()`)
    .catch(() => undefined);
  await page.waitForLoadState("domcontentloaded");

  while (!(await ready(page))) await page.waitForTimeout(50);

  await page.waitForTimeout(400);
};

/** Renderer time from openFile to its lines painted, in the page (the preview's `__polarisEditor`). */
const openTimed = (page: Page, path: string) =>
  page.evaluate<number>(`(async () => {
    const start = performance.now();
    window.__polarisEditor.openFile({ hostKey: "studio", workspaceId: "ws-polaris", path: ${JSON.stringify(path)} });
    const shown = () =>
      document.querySelectorAll(".cm-content .cm-line").length > 10 &&
      document.querySelector('[data-testid="editor-tab"][aria-selected="true"]')?.getAttribute("title") === ${JSON.stringify(path)};
    while (!shown()) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return performance.now() - start;
  })()`);

const typing = async (page: Page, label: string, frame: number) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.evaluate(KEY_LATENCY);
  await page.keyboard.type(TYPED, { delay: 25 });
  await page.waitForTimeout(300);
  const lat = await page.evaluate<ReadonlyArray<number>>("window.__keys.stop()");

  record(`${label} key-to-paint p50`, quantile(lat, 0.5), "ms", null);
  record(`${label} key-to-paint p95`, quantile(lat, 0.95), "ms", frame * 2);
  record(`${label} key-to-paint max`, quantile(lat, 1), "ms", null);
};

const memory = (app: ElectronApplication): number => {
  const pid = app.process().pid;

  if (pid === undefined) return Number.NaN;

  const out = execFileSync(
    "bun",
    [join(APP_DIR, "scripts/lib/sampleTree.ts"), "3000", `app=${pid}`],
    {
      encoding: "utf8",
    }
  );
  // SAFETY: sampleTree.ts prints one JSON object per line with footprintMiB / rssMiB.

  const row = JSON.parse(out.trim().split("\n")[0] ?? "{}") as {
    footprintMiB: number | null;
    rssMiB: number;
  };

  return row.footprintMiB ?? row.rssMiB;
};

const savedText = (page: Page, path: string) =>
  page.evaluate<string | null>(
    `window.__polarisEditor.files.text("studio", ${JSON.stringify(path)})`
  );

const checkSaves = async (page: Page) => {
  await scene(page, "e1");
  await page.locator(".cm-content").click();
  await page.keyboard.type("// saved by ⌘S");
  await page.keyboard.press("Meta+S");
  await page.waitForTimeout(300);
  const viaShortcut = (await savedText(page, SMALL))?.includes("// saved by ⌘S") ?? false;

  log(`⌘S saves: ${viaShortcut ? "yes" : "NO"}`);

  await scene(page, "vim");
  await page.locator(".cm-content").click();
  await page.keyboard.type("Go// saved by :w");
  await page.keyboard.press("Escape");
  const mode = await page.getByTestId("vim-mode").textContent();

  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const viaVim = (await savedText(page, SMALL))?.includes("// saved by :w") ?? false;

  log(`vim mode shown after esc: ${mode ?? "none"}; :w saves: ${viaVim ? "yes" : "NO"}`);

  await page.keyboard.type("o// saved by ⌘S in insert");
  const insert = await page.getByTestId("vim-mode").textContent();

  await page.keyboard.press("Meta+S");
  await page.waitForTimeout(300);
  const fromInsert = (await savedText(page, SMALL))?.includes("in insert") ?? false;

  log(`vim ${insert ?? "?"}: ⌘S saves: ${fromInsert ? "yes" : "NO"}`);

  return viaShortcut && viaVim && fromInsert && mode === "NORMAL" && insert === "INSERT";
};

const home = mkdtempSync(join(tmpdir(), "polaris-editor-bench-"));

const userData = join(home, "user-data");

mkdirSync(userData, { recursive: true });

writeFileSync(
  join(userData, "settings.json"),
  JSON.stringify({ welcomeSeen: true, theme: "dark", local: { enabled: false } })
);

const app = await electron.launch({
  executablePath: electronBinary(),
  args: [APP_DIR],
  env: { ...process.env, POLARIS_DESKTOP_USER_DATA: userData },
});

let failed = false;

try {
  const page = await app.firstWindow();

  await page.setViewportSize({ width: 1440, height: 900 });
  await scene(page, "empty");
  const frame = await page.evaluate<number>(FRAME);

  record("display frame interval", frame, "ms", null);

  const opens: Array<number> = [];

  for (let i = 0; i < 5; i++) {
    await scene(page, "empty");
    opens.push(await openTimed(page, BIG));
  }

  record("open 1 MB file (renderer, median of 5)", quantile(opens, 0.5), "ms", 150);

  await typing(page, "typing, 1 MB file", frame);
  await scene(page, "empty");
  await openTimed(page, SMALL);
  await typing(page, "typing, small file", frame);

  await scene(page, "vim");
  await page.locator(".cm-content").click();
  await page.keyboard.press("o");
  await typing(page, "typing, vim insert", frame);

  await scene(page, "empty");
  await page.waitForTimeout(1500);
  const before = memory(app);

  await scene(page, "tabs20");
  await page.waitForTimeout(1500);
  // Visit every tab, so each one's editor has rendered.

  for (let i = 0; i < 20; i++) await page.keyboard.press("Control+Tab");
  await page.waitForTimeout(1500);
  const after = memory(app);

  record("app memory, empty editor", before, "MiB", null);
  record("app memory, 20 open tabs", after, "MiB", 1024);
  record("20 tabs over the empty editor", after - before, "MiB", null);

  failed =
    !(await checkSaves(page)) || results.some((r) => r.budget !== null && r.value > r.budget);
} finally {
  await app.close();
  rmSync(home, { recursive: true, force: true });
}

if (jsonOut !== null) writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);

log(failed ? "FAILED" : "ok");

process.exitCode = failed ? 1 : 0;
