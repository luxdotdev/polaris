#!/usr/bin/env node
/**
 * Shared Sessions end to end (ENG-941, Paper SS1–SS4): a local Account Server with a fake GitHub
 * and a real relay (`lib/sharingServers.ts`), the owner's Daemon and app signed in as @octocat,
 * and a second app instance with its own Daemon signed in as @hubot. The owner shares a session
 * from its header; the Teammate opens the Invite from "Shared with you" and watches it through
 * the relay; then the owner's Host goes offline. Screenshots in both themes and three densities.
 * Needs `bun scripts/build.ts --no-app` and Docker. No real GitHub, relay or Polaris Cloud.
 *
 *   POLARIS_RELAY_BIN=<polaris-relay> node scripts/sharingE2e.ts <out dir>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ElectronApplication, Page } from "playwright-core";
import { startDaemon, type TestDaemon } from "./lib/daemon.ts";
import {
  scriptedElectron as electron,
  APP_DIR,
  electronBinary,
  sizeWindow,
} from "./lib/electron.ts";
import { MOCK_KEYCHAIN } from "./lib/githubFlow.ts";
import { seedSource } from "./lib/seed.ts";

const out = process.argv[2] ?? join(tmpdir(), "polaris-sharing-e2e");

mkdirSync(out, { recursive: true });

const helper = spawn("bun", [join(APP_DIR, "scripts/lib/sharingServers.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
});

const ready = await new Promise<string>((resolve, reject) => {
  const lines = createInterface({ input: helper.stdout });

  lines.on("line", (line) => {
    if (line.startsWith("SHARING ")) resolve(line.slice("SHARING ".length));
  });
  helper.once("exit", (code) => reject(new Error(`sharing servers exited ${code}`)));
});

// SAFETY: lib/sharingServers.ts prints exactly this shape after "SHARING ".
const { server, relay, browser } = JSON.parse(ready) as {
  readonly server: string;
  readonly relay: string;
  readonly browser: string;
};

const home = mkdtempSync(join(tmpdir(), "pl-share-"));

const log = (line: string) => console.log(`sharing-e2e: ${line}`);

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}.png`) });
  log(`saved ${name}.png`);
};

type Patch = Readonly<Record<string, string>>;

const appearance = (page: Page, patch: Patch) =>
  page.evaluate(
    `window.polaris.request("settings.setAppearance", { patch: ${JSON.stringify(patch)} })`
  );

/** Every theme and density: dark and light at Calm, Balanced and Compact. */
const shootAll = async (page: Page, name: string) => {
  for (const theme of ["dark", "light"])
    for (const density of ["calm", "balanced", "compact"]) {
      await appearance(page, { theme, density });
      await shoot(page, `${name}-${theme}-${density}`);
    }

  await appearance(page, { theme: "dark", density: "calm" });
};

const request = async <T>(
  page: Page,
  method: string,
  input: Readonly<Record<string, string>>
): Promise<T> => {
  const result: unknown = await page.evaluate(
    `window.polaris.request(${JSON.stringify(method)}, ${JSON.stringify(input)})`
  );

  // SAFETY: every bridge request answers `{ ok, value } | { ok: false, error }`.
  const answer = result as
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { code: string; message: string } };

  if (!answer.ok) throw new Error(`${method}: ${answer.error.code} ${answer.error.message}`);

  return answer.value;
};

interface Instance {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly daemon: TestDaemon;
}

const launch = async (name: string, login: string, label: string): Promise<Instance> => {
  const daemon = await startDaemon({
    home: join(home, `${name}-d`),
    benchHarness: true,
    fileSecrets: true,
  });

  const userData = join(home, `${name}-ud`);

  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, "settings.json"),
    JSON.stringify({ theme: "dark", welcomeSeen: true })
  );

  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [APP_DIR, MOCK_KEYCHAIN],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_LOCAL_LABEL: label,
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
      POLARIS_DESKTOP_RELAY_URL: relay,
    },
  });

  // The system browser is the stand-in, signing this instance's person in.
  await app.evaluate(
    ({ shell }, { standIn, as }) => {
      shell.openExternal = async (url: string) => {
        const response = await fetch(`${standIn}/open?as=${as}&url=${encodeURIComponent(url)}`);

        if (!response.ok) throw new Error(await response.text());
      };
    },
    { standIn: browser, as: login }
  );

  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 30_000 });
  await request(page, "accounts.signIn.start", { server });
  await page.evaluate(`new Promise((resolve) => {
    const off = window.polaris.subscribe("accounts", {}, { items: (items) => {
      if (items.at(-1)?.accounts.some((a) => a.login === ${JSON.stringify(login)})) {
        off();
        resolve(true);
      }
    } });
  })`);
  log(`${name} signed in as @${login}`);

  return { app, page, daemon };
};

const instances: Array<Instance> = [];

try {
  const owner = await launch("owner", "octocat", "Mac Studio");

  instances.push(owner);
  await request(owner.page, "relayRoute.setUrl", { hostKey: "local", url: relay });
  await owner.page.evaluate(
    seedSource([
      {
        hostKey: "local",
        name: "polaris",
        sessions: [{ title: "Fix the login redirect", state: "idle" }],
      },
    ])
  );

  const teammate = await launch("teammate", "hubot", "MacBook Pro");

  instances.push(teammate);

  // Owner: the session's header, its Share button and the share sheet (SS1, SS3).
  await owner.page.getByText("Fix the login redirect").first().click();
  await owner.page.getByTestId("session-title").waitFor({ timeout: 10_000 });
  await shootAll(owner.page, "owner-solo");
  await owner.page.getByTestId("share-session").click();
  await owner.page.getByLabel("GitHub handle").fill("@nobody-here");
  await owner.page.getByTestId("share-submit").click();
  await owner.page.getByTestId("share-refusal").waitFor({ timeout: 15_000 });
  log(`unknown person: ${await owner.page.getByTestId("share-refusal").innerText()}`);
  await shoot(owner.page, "share-sheet-unknown-person-dark");
  await owner.page.getByLabel("GitHub handle").fill("@hubot");
  await owner.page.getByTestId("share-submit").click();

  const shared = await owner.page
    .getByTestId("share-person")
    .filter({ hasText: /hubot/i })
    .waitFor({ timeout: 15_000 })
    .then(
      () => true,
      () => false
    );

  if (!shared) {
    await shoot(owner.page, "failed-share");
    const refusal = owner.page.getByTestId("share-refusal");
    const reason = (await refusal.isVisible()) ? await refusal.innerText() : "no refusal shown";

    throw new Error(`@hubot was not shared with: ${reason}`);
  }

  await shootAll(owner.page, "share-sheet-shared");
  await owner.page.keyboard.press("Escape");

  // Teammate: the Invite in "Shared with you" (SS4), then the session through the relay (SS2).
  await request(teammate.page, "sharing.invites.refresh", {});

  const invite = teammate.page
    .getByTestId("share-invite")
    .filter({ hasText: "Fix the login redirect" });

  await invite.waitFor({ timeout: 20_000 });
  await shootAll(teammate.page, "teammate-invite");
  await invite.getByRole("button", { name: "Open", exact: true }).click();
  await teammate.page.getByTestId("share-role").waitFor({ timeout: 45_000 });
  await teammate.page
    .getByTestId("session-title")
    .filter({ hasText: "Fix the login redirect" })
    .waitFor({ timeout: 45_000 });
  log("teammate opened the shared session through the relay");

  if ((await teammate.page.getByTestId("paperclip-input").count()) > 0)
    throw new Error("a Commenter was offered the composer");
  await shootAll(teammate.page, "teammate-session");

  // Owner: the Teammate appears in the presence row (SS1).
  await owner.page.getByTestId("session-presence").waitFor({ timeout: 20_000 });
  await shootAll(owner.page, "owner-presence");

  // The owner's Host goes away: "Host offline" with the cached transcript.
  await owner.app.close();
  await owner.daemon.stop();
  instances.shift();
  await teammate.page.getByText("Host offline").first().waitFor({ timeout: 60_000 });
  await shootAll(teammate.page, "teammate-host-offline");
  log("end to end: shared, opened through the relay, Host offline shown");
} finally {
  for (const { app, daemon } of instances) {
    await app.close().catch(() => undefined);
    await daemon.stop();
  }

  helper.stdin.end();
  rmSync(home, { recursive: true, force: true });
}
