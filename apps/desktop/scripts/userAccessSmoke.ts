#!/usr/bin/env node
/**
 * User access across two Desktop Apps on one real Daemon (ENG-927, ADR 0114): the first is
 * enrolled on first use, the second waits and shows its code, the first allows it, then revokes it on the host page. Screenshots of each step go to `--out`.
 *
 *   node scripts/userAccessSmoke.ts --out <dir> [--build]
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "playwright-core";
import { takeScriptLease } from "../../../tooling/leases.ts";
import { startDaemon } from "./lib/daemon.ts";
import { APP_DIR, electronBinary, scriptedElectron as electron } from "./lib/electron.ts";
import { seenUserData } from "./lib/userData.ts";

const args = process.argv.slice(2);

const at = args.indexOf("--out");

const out = at === -1 ? null : (args[at + 1] ?? null);

if (out === null) throw new Error("--out <dir> is required");

await takeScriptLease("smoke");

if (args.includes("--build"))
  spawnSync("bun", [join(APP_DIR, "scripts/build.ts"), "--no-app"], { stdio: "inherit" });

// A short path: the Daemon's Unix socket lives under it.
const home = mkdtempSync("/tmp/pua-");

const daemon = await startDaemon({ home, benchHarness: true });

/** A Desktop App with its own user data, so its own user key, on the shared Daemon. */
const launch = (name: string) =>
  electron.launch({
    executablePath: electronBinary(),
    args: ["--use-mock-keychain", APP_DIR],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_LOCAL_LABEL: "Mac Studio",
      POLARIS_DESKTOP_USER_DATA: seenUserData(join(home, name)),
      POLARIS_DESKTOP_HIDDEN: "1",
    },
  });

const shot = async (page: Page, name: string) => {
  const path = join(out, `${name}.png`);

  await page.screenshot({ path });
  console.log(`screens: ${path}`);
};

/** Settings → Hosts → this Mac's page. */
const hostPage = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = page.getByText("Back to orchestrate");

  // The window takes ⌘, only once the shell has mounted: press until Settings shows.
  for (let attempt = 0; attempt < 10 && !(await settings.isVisible()); attempt += 1) {
    await page.keyboard.press("Meta+,");
    await settings.waitFor({ timeout: 3_000 }).catch(() => undefined);
  }

  // Inside Settings: the top bar has a Hosts button of its own while Settings is closed.
  await page.getByRole("button", { name: "Hosts", exact: true }).click();
  await page.getByTestId("hosts-settings").waitFor({ timeout: 15_000 });
  await shot(page, "debug-hosts");
  await page.getByTestId("machine-local").getByRole("button").click({ timeout: 10_000 });
  await page.getByTestId("host-page").waitFor({ timeout: 15_000 });
};

/** Whether the user gate refuses this app a user-only request (revoking a Pairing that isn't there). */
const gated = (page: Page) =>
  page.evaluate<boolean>(`(async () => {
    const reply = await window.polaris.request("extensions.revoke", { hostKey: "local", id: "none" });
    return !reply.ok && reply.error.code === "UserAccessRequired";
  })()`);

const first = await launch("first");

let second: Awaited<ReturnType<typeof launch>> | null = null;

try {
  mkdirSync(out, { recursive: true });
  const studio = await first.firstWindow();

  await hostPage(studio);
  const apps = studio.getByTestId("desktop-apps-card");

  await apps.getByText("This desktop app · allowed").waitFor({ timeout: 15_000 });
  await apps.getByText("1 allowed").waitFor();
  assert.equal(await gated(studio), false, "the first Desktop App holds user access");
  console.log("user access: the first Desktop App was enrolled on first use");
  await apps.scrollIntoViewIfNeeded();
  await shot(studio, "1-first-enrolled");

  second = await launch("second");
  const laptop = await second.firstWindow();

  await hostPage(laptop);
  const notice = laptop.getByTestId("user-access-notice");

  await notice.getByText("This desktop app is waiting to be allowed on Mac Studio.").waitFor({
    timeout: 15_000,
  });
  const code = (await notice.locator("pre").textContent())?.trim() ?? "";

  assert.match(code, /^[0-9A-F]{3}-[0-9A-F]{3}$/, "the waiting app shows its code");
  assert.equal(await gated(laptop), true, "the second Desktop App is refused while it waits");
  assert.equal(await laptop.getByTestId("desktop-apps-card").count(), 0);
  console.log(`user access: the second Desktop App waits with code ${code}`);
  await shot(laptop, "2-second-waiting");

  // The first app is asked, in a toast that stays, with the same code; the card lists it too.
  const toast = studio.locator("[data-sonner-toast]");

  await toast.getByText(`Only if it shows ${code}.`, { exact: false }).waitFor({ timeout: 15_000 });
  await apps.getByText("1 allowed · 1 asking").waitFor();
  await apps.getByText(code).waitFor();
  await shot(studio, "3-first-asked");

  // Allowed from the card, the toast that asked the same comes down.
  await apps.getByRole("button", { name: "Allow", exact: true }).click();
  await toast.waitFor({ state: "detached", timeout: 15_000 });

  await notice.waitFor({ state: "detached", timeout: 15_000 });
  await laptop.getByTestId("desktop-apps-card").getByText("2 allowed").waitFor({ timeout: 15_000 });
  assert.equal(await gated(laptop), false, "allowed, the second Desktop App holds user access");
  console.log(
    "user access: allowed from the first, the second holds user access without reconnecting"
  );
  await laptop.getByTestId("desktop-apps-card").scrollIntoViewIfNeeded();
  await shot(laptop, "4-second-allowed");

  // Revoke asks in place, then cuts the second app off at once.
  await apps.getByText("2 allowed").waitFor();
  await apps.getByRole("button", { name: "Revoke", exact: true }).last().click();
  await apps.getByText("It can ask again.").waitFor();
  await shot(studio, "5-first-revoking");
  await apps.getByRole("button", { name: /^Revoke / }).click();

  await laptop
    .getByText("This desktop app isn't allowed on Mac Studio.")
    .waitFor({ timeout: 15_000 });
  assert.equal(await gated(laptop), true, "revoked, the second Desktop App is refused at once");
  await apps.getByText("1 allowed").waitFor();
  console.log("user access: revoked, the second Desktop App is refused at once");
  await shot(laptop, "6-second-revoked");
  console.log("user access: ok");
} finally {
  await second?.close().catch(() => undefined);
  await first.close().catch(() => undefined);
  await daemon.stop();
  rmSync(home, { recursive: true, force: true });
}
