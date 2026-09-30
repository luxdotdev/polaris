/**
 * The session view in the smoke test: register a git Workspace, start a bench
 * session from the new-session page in the Workspace directory, approve what it asks,
 * see its Turn diff, then send a follow-up Turn and sample frame intervals
 * while it streams.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

const bench = (script: Record<string, number>) => `bench:${JSON.stringify(script)}`;

/** A file written under the session's cwd shows in the rail's count without a reload (files.watch). */
const liveChanges = async (page: Page, step: (line: string) => void) => {
  const changes = page.getByTestId("output-rail-changes");
  const before = (await changes.textContent()) ?? "";

  const cwd = await page
    .getByTestId("output-rail")
    .locator("[title]")
    .first()
    .getAttribute("title");

  if (cwd === null) throw new Error("the rail shows no path");
  writeFileSync(join(cwd, "smoke-live.txt"), "written while output watched\n");
  await changes.filter({ hasNotText: before }).waitFor({ timeout: 5_000 });
  step(`rail updated live: ${before} → ${await changes.textContent()}`);
  rmSync(join(cwd, "smoke-live.txt"));
  await changes.filter({ hasText: before }).waitFor({ timeout: 5_000 });
};

/** Items 2, 5 and 8 ask first; two files are written, so the Turn has a diff. */
export const FIRST_TURN = bench({
  items: 9,
  deltasPerItem: 30,
  deltaBytes: 48,
  deltaIntervalMs: 20,
  approvalEvery: 3,
  touchFiles: 2,
});

/** About eight seconds of streaming, for the frame sample. */
const FOLLOW_UP = bench({ items: 8, deltasPerItem: 100, deltaBytes: 64, deltaIntervalMs: 10 });

export const initRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  const git = (...args: Array<string>) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });

  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# smoke\n");
  git("add", ".");
  git("-c", "user.name=smoke", "-c", "user.email=smoke@polaris.invalid", "commit", "-qm", "init");
};

/** Frame intervals (ms) over `ms`, from rAF timestamps in the renderer. */
const sampleFrames = (page: Page, ms: number) =>
  page.evaluate<ReadonlyArray<number>>(`new Promise((resolve) => {
    const times = [];
    const end = performance.now() + ${ms};
    const tick = (t) => { times.push(t); if (t < end) requestAnimationFrame(tick); else resolve(times); };
    requestAnimationFrame(tick);
  })`);

export const frameStats = (times: ReadonlyArray<number>) => {
  const gaps = times
    .slice(1)
    .map((t, i) => t - (times[i] ?? t))
    .toSorted((a, b) => a - b);

  const at = (q: number) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0;
  const over = (limit: number) => gaps.filter((g) => g > limit).length / Math.max(1, gaps.length);

  return {
    frames: gaps.length,
    p50: at(0.5).toFixed(2),
    p95: at(0.95).toFixed(2),
    p99: at(0.99).toFixed(2),
    max: at(1).toFixed(2),
    over8_33: `${(over(8.34) * 100).toFixed(2)}%`,
    over16_7: `${(over(16.7) * 100).toFixed(2)}%`,
  };
};

export const approveAll = async (page: Page, step: (m: string) => void) => {
  const state = page.getByTestId("session-state");
  let approved = 0;

  for (let i = 0; i < 40; i++) {
    if (((await state.textContent()) ?? "").startsWith("Idle")) return approved;
    const approve = page.getByTestId("approval").getByRole("button", { name: /^Approve/ });

    if ((await approve.count()) > 0) {
      await approve.first().click();
      approved++;
      step(`approved ${approved}`);
    }

    await page.waitForTimeout(500);
  }

  throw new Error("the first Turn never finished");
};

/** The bench Harness's stand-in Models: pick Bench Large at high effort between Turns. */
const MODEL = "Bench Large · high";

const switchModel = async (
  page: Page,
  step: (m: string) => void,
  shoot: (name: string) => Promise<void>
) => {
  const chip = page.getByTestId("model-picker");

  await chip.click();
  await page.getByTestId("model-option").filter({ hasText: "Bench Large" }).click();
  await page.getByTestId("effort-high").waitFor();
  await shoot("model-picker");
  await page.getByTestId("effort-high").click();
  await chip.filter({ hasText: MODEL }).waitFor({ timeout: 10_000 });
  step(`SetModel between Turns: ${MODEL}`);
};

export interface FlowInput {
  readonly page: Page;
  readonly repo: string;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
  /** Runs at the first approval; returns how many it answered. The conversation does the rest. */
  readonly atFirstApproval?: () => Promise<number>;
}

export const sessionFlow = async ({ page, repo, step, shoot, atFirstApproval }: FlowInput) => {
  await page.evaluate(
    `window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: { _tag: "RegisterWorkspace", path: ${JSON.stringify(repo)}, name: "smoke-repo" } })`
  );
  // From the shell: its Workspace chip, then the title bar's New session.
  await page
    .getByRole("button", { name: /smoke-repo/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New session" }).first().click();
  await page.getByTestId("new-session").waitFor();
  await page.getByTestId("where-line").filter({ hasText: "in place" }).waitFor();
  // Only a ready Harness is pre-selected (bench mode: Claude Code and Codex).
  const picked = page.locator('[role="radiogroup"][aria-label="Harness"] [aria-checked="true"]');

  await picked.waitFor();
  const pickedId = await picked.getAttribute("data-testid");

  if (pickedId !== "harness-claude" && pickedId !== "harness-codex")
    throw new Error(`the new-session page pre-selected ${pickedId}, which isn't ready`);
  step(`pre-selected a ready harness: ${pickedId}`);
  const input = page.getByTestId("composer-input");

  await input.fill("Remove stale review checkouts once their pull request merges");
  await shoot("new-session");
  await input.fill(FIRST_TURN);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("session-panel").waitFor({ timeout: 15_000 });
  step("session started from the new-session page");
  // A new session starts with Output collapsed to its rail; the first edit opens it.
  await page.getByTestId("output-rail").waitFor();
  step("output collapsed to the rail");

  await page.getByTestId("live-item").first().waitFor({ timeout: 15_000 });
  step("first Turn streaming");
  await page.getByTestId("approval").first().waitFor({ timeout: 20_000 });
  await shoot("approval");
  const inboxApproved = atFirstApproval === undefined ? 0 : await atFirstApproval();
  const approved = inboxApproved + (await approveAll(page, step));

  if (approved === 0) throw new Error("no approval was asked");
  step("first Turn finished");

  await page.getByTestId("diff-file").first().waitFor({ timeout: 10_000 });
  const files = await page.getByTestId("diff-file").count();

  step(`Turn diff: ${files} files`);
  await page.getByTestId("output-panel").waitFor();
  step("the first edit opened output");

  if (files < 2) throw new Error(`expected the 2 bench files in the diff, saw ${files}`);
  // The bench Harness fills 15% of its window a Turn and times its thinking.
  await page.getByTestId("session-context").filter({ hasText: "Context 15%" }).waitFor();
  await page
    .getByTestId("thought-label")
    .filter({ hasText: /^Thought for \d/ })
    .first()
    .waitFor();
  step("header shows Context 15%; thinking reads Thought for Ns");
  await shoot("session-idle");
  await page.keyboard.press("Meta+Alt+KeyB");
  await page.getByTestId("output-rail").waitFor();
  await shoot("output-rail");
  await liveChanges(page, step);
  await page.keyboard.press("Meta+Alt+KeyB");
  await page.getByTestId("output-panel").waitFor();
  step("⌘⌥B hides and shows output");
  await switchModel(page, step, shoot);

  await input.fill(FOLLOW_UP);
  await input.press("Enter");
  await page
    .getByTestId("session-state")
    .filter({ hasText: /^Working/ })
    .waitFor();
  // The new Turn records the Model it runs on, under its prompt (before streaming scrolls it away).
  await page.getByTestId("turn-model").filter({ hasText: MODEL }).first().waitFor();
  step(`the follow-up Turn runs on ${MODEL}`);
  await page.getByTestId("live-item").first().waitFor();
  await steer(page, step);
  await page.waitForTimeout(300);
  await shoot("session-working");
  const frames = frameStats(await sampleFrames(page, 5000));

  step(`frames while streaming: ${JSON.stringify(frames)}`);
  await page.getByTestId("session-state").filter({ hasText: /^Idle/ }).waitFor({ timeout: 60_000 });
  // The folded Turn is at the top, virtualized out while the list sits at the end.
  await page.evaluate(
    `document.querySelector('[data-testid="conversation"]').scrollTo({ top: 0 })`
  );
  await page.getByTestId("turn-summary").first().waitFor({ timeout: 5_000 });
  step("follow-up Turn finished; the first folded");

  return frames;
};

const STEER = "Keep the change to one file";

/** ↵ while Working steers: the message shows at once and lands in the Turn, never vanishing. */
const steer = async (page: Page, step: (m: string) => void) => {
  const input = page.getByTestId("composer-input");

  await input.fill(STEER);
  await input.press("Enter");
  await page
    .locator('[data-testid="outgoing"], [data-testid="steered"]')
    .filter({ hasText: STEER })
    .first()
    .waitFor({ timeout: 2_000 });
  await page.getByTestId("steered").filter({ hasText: STEER }).waitFor({ timeout: 10_000 });

  if ((await page.getByTestId("outgoing").count()) > 0)
    throw new Error("the steer landed but its pending message stayed");
  step("steer shown at once, then landed in the Turn");
};

/**
 * A Host with no ready Harness (the Raspberry Pi case, on fixtures): nothing pre-selected, a
 * neutral chip, Start off, and each Harness's reason with its docs, never an install.
 */
export const checkNoneReady = async (page: Page, step: (m: string) => void) => {
  await page.evaluate(`location.hash = "#preview/none-ready"; location.reload()`);
  await page.getByTestId("harness-not-ready").waitFor();

  const checked = await page
    .locator('[role="radiogroup"][aria-label="Harness"] [aria-checked="true"]')
    .count();

  const chip = await page.getByTestId("model-picker").textContent();
  const sendOff = await page.getByRole("button", { name: "Send" }).isDisabled();
  const claude = await page.getByTestId("not-ready-claude").textContent();
  const installs = await page.getByRole("button", { name: /install|update/i }).count();

  if (checked !== 0) throw new Error("a Harness was pre-selected though none is ready");

  if (chip !== "No harness ready") throw new Error(`the chip reads "${chip}"`);

  if (!sendOff) throw new Error("Start is enabled though no Harness is ready");

  if (claude?.includes("needs 2.1.0 or newer") !== true)
    throw new Error(`Claude Code's reason reads "${claude}"`);

  if (installs !== 0) throw new Error("an install or update action is offered");
  step(`none ready: no pre-selection, Start off, "${claude?.replace("Setup guide", "").trim()}"`);
};
