/**
 * An Agent Session's Turns in Review, as the user first met them (UB diffview 1): three
 * Turns that change one file between them, other commits landing on the branch between
 * Turns (HEAD moves under the session), and the Daemon restarted so the session is
 * dormant. The diff must render that file, never leave the pane blank.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=smoke", "-c", "user.email=smoke@polaris.invalid", ...args],
    {
      cwd,
      stdio: "pipe",
    }
  )
    .toString()
    .trim();

/** A repository with one commit, as a Workspace starts. */
export const initSessionRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# review-session\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
};

/** Someone else commits to the branch: HEAD moves, the session's own edits stay uncommitted. */
const commitElsewhere = (dir: string, n: number) => {
  writeFileSync(join(dir, `other-${n}.md`), `merged ${n}\n`);
  git(dir, "add", `other-${n}.md`);
  git(dir, "commit", "-qm", `merge ${n}`);
};

const bench = (touchFiles: number) =>
  `bench:${JSON.stringify({ items: 1, deltasPerItem: 1, deltaIntervalMs: 1, touchFiles })}`;

/** Page source: registers the Workspace, starts the session; resolves with its id. */
const startSource = (repo: string) => `(async () => {
  const api = window.polaris;
  const must = (r, what) => { if (!r.ok) throw new Error(what + ": " + r.error.message); return r.value; };
  const dispatch = (command) =>
    api.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command }).then((r) => must(r, command._tag));
  await dispatch({ _tag: "RegisterWorkspace", path: ${JSON.stringify(repo)}, name: "review-session" });
  const workspaceId = await new Promise((resolve) => {
    const close = api.subscribe("host", { hostKey: "local" }, { items: (items) => {
      for (const i of items) {
        const all = i._tag === "Snapshot" ? i.workspaces
          : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? [i.envelope.event.workspace] : [];
        const found = all.find((w) => w.path === ${JSON.stringify(repo)});
        if (found) { close(); resolve(found.id); return; }
      }
    } });
  });
  const sessionId = crypto.randomUUID();
  await dispatch({ _tag: "StartSession", sessionId, workspaceId, harness: "claude",
    placement: { _tag: "InPlace" }, permissionMode: "auto", model: null, effort: null,
    prompt: ${JSON.stringify(bench(1))}, attachments: [] });
  await dispatch({ _tag: "RenameSession", sessionId, title: "One file across three turns" });
  return sessionId;
})()`;

const sendSource = (sessionId: string, prompt: string) =>
  `window.polaris.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command: { _tag: "SendTurn", sessionId: ${JSON.stringify(sessionId)}, prompt: ${JSON.stringify(prompt)}, attachments: [] } })`;

/** Waits until git holds `count` after-checkpoints for the session (each Turn has ended). */
const waitForTurns = async (repo: string, sessionId: string, count: number) => {
  for (let i = 0; i < 100; i++) {
    const refs = git(
      repo,
      "for-each-ref",
      "--format=%(refname)",
      `refs/polaris/checkpoints/${sessionId}`
    )
      .split("\n")
      .filter((r) => r.endsWith("/after"));

    if (refs.length >= count) return;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`the session never finished ${count} Turns`);
};

/** Runs the session's three Turns, moving HEAD between them; resolves with its id. */
export const runSessionTurns = async (page: Page, repo: string): Promise<string> => {
  const sessionId = String(await page.evaluate(startSource(repo)));

  await waitForTurns(repo, sessionId, 1);
  commitElsewhere(repo, 1);
  await page.evaluate(sendSource(sessionId, bench(0)));
  await waitForTurns(repo, sessionId, 2);
  commitElsewhere(repo, 2);
  await page.evaluate(sendSource(sessionId, bench(0)));
  await waitForTurns(repo, sessionId, 3);
  commitElsewhere(repo, 3);

  return sessionId;
};

/** Opens the session in Review with ⌘↵ from the jump menu (works signed out of GitHub too). */
export const checkSessionReview = async (page: Page, step: (message: string) => void) => {
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
  await page.getByRole("button", { name: /^Jump to/ }).click();
  await page.keyboard.type("One file across");
  await page
    .getByTestId("jump-item")
    .filter({ hasText: "One file across three turns" })
    .first()
    .waitFor();
  await page.keyboard.press("Meta+Enter");
  await page.getByTestId("session-review").waitFor();
  await page.getByTestId("review-tab-changes").click();

  const file = page.locator('[data-testid="review-file"][data-path="polaris-bench/file-0.txt"]');
  const waiting = page.getByTestId("review-waiting");

  // The file, or a sentence saying why not; still "Reading the diff…" after this is a hang.
  for (let i = 0; i < 120 && (await file.count()) === 0; i++) {
    const text = (await waiting.textContent().catch(() => null)) ?? "";

    if (text !== "" && !text.startsWith("Reading the diff")) break;

    await page.waitForTimeout(250);
  }

  if ((await file.count()) === 0) {
    throw new Error(
      `the session's Review shows no diff: ${(await waiting.textContent()) ?? "a blank pane"}`
    );
  }

  step(
    `a dormant session's Review (3 Turns, 1 file, HEAD moved under it): ${await page.getByTestId("turn-divider").count()} Turn rows, polaris-bench/file-0.txt rendered`
  );
};

/** Every Turn in the picker, then all of them again: each must show its file or say why not. */
export const checkTurnPicker = async (page: Page, step: (message: string) => void) => {
  const seen: Array<string> = [];

  for (const label of ["1", "2", "3", "All 3 turns", "1", "All 3 turns"]) {
    await page.getByRole("radio", { name: label, exact: true }).click();
    await page.waitForTimeout(800);

    const files = await page.getByTestId("review-file").count();

    const waiting =
      files > 0
        ? ""
        : ((await page
            .getByTestId("review-waiting")
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "");

    seen.push(`${label}: ${files > 0 ? `${files} file` : waiting === "" ? "BLANK" : waiting}`);
  }

  step(`Turn picker: ${seen.join("; ")}`);

  if (seen.some((s) => s.endsWith("BLANK")))
    throw new Error(`a blank diff pane: ${seen.join("; ")}`);
};
