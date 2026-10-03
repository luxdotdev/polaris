import { verifyLiveFeed } from "./feed.regression.testing.ts";
import { verifyEffectivePreferences } from "./effective.regression.testing.ts";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass owned temporary output directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-u1-render-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(temporary, "vite-cache"),
  server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
});

let app;

let failurePage: import("playwright-core").Page | undefined;

const errors: Array<string> = [];

try {
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("No fixture address");
  const entry = join(temporary, "main.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, "user-data"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}integration.evidence.html`)});});`
  );
  app = await _electron.launch({ executablePath: stockElectronBinary(), args: [entry] });
  const page = await app.firstWindow();
  failurePage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Configure language integrations" }).click();
  await page.getByRole("heading", { name: "Language integrations", exact: true }).waitFor();
  await page.getByLabel("Language", { exact: true }).selectOption("python");
  await page
    .getByLabel("Checkout for discovery and trust")
    .selectOption("fake-0:worktree:fake-worktree");
  await page.getByText("This worktree inherits its workspace's trust.", { exact: false }).waitFor();

  if (process.argv[3] === "feed") {
    await verifyLiveFeed(page, output);
    assert.deepEqual(errors, []);
  } else if (process.argv[3] === "effective") {
    await verifyEffectivePreferences(page, output);
    assert.deepEqual(errors, []);
  } else {
    assert.equal(await page.getByRole("button", { name: "Install", exact: true }).count(), 0);
    assert.equal(
      await page.getByRole("switch", { name: "Format on save" }).getAttribute("aria-checked"),
      "true"
    );

    for (const theme of ["dark", "light"])
      for (const density of ["calm", "balanced", "compact"]) {
        await page.evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.density=${JSON.stringify(density)};document.documentElement.dataset.reduceMotion='true';document.documentElement.dataset.diffPalette='cvd'`
        );
        await page.getByLabel("Language", { exact: true }).focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page
            .getByLabel("Checkout for discovery and trust")
            .evaluate((el) => el === document.activeElement),
          true
        );
        assert.notEqual(
          await page
            .getByLabel("Checkout for discovery and trust")
            .evaluate((el) => getComputedStyle(el).outlineStyle),
          "none"
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false
        );
        await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
      }

    await page.getByRole("switch", { name: "Format on save" }).click();
    assert.equal(await page.getByLabel("Language", { exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Save language settings", exact: true }).click();
    await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
    assert.equal(
      await page.getByRole("switch", { name: "Format on save" }).getAttribute("aria-checked"),
      "false"
    );
    await page.getByLabel("External images", { exact: true }).selectOption("allow");
    await page.getByText("Preview policy saved.", { exact: true }).waitFor();
    await page.getByLabel("External images", { exact: true }).selectOption("deny");
    await page.waitForFunction("window.integrationFixture.refreshes.length === 2");
    await page.evaluate("window.integrationFixture.control.fail=true");
    await page.getByLabel("External images", { exact: true }).selectOption("allow");
    await page
      .getByText("Couldn't save preview policy. Refresh to retry.", { exact: true })
      .waitFor();
    assert.equal(await page.evaluate("window.integrationFixture.refreshes.length"), 2);
    await page.evaluate(
      "window.integrationFixture.control.fail=false; window.integrationFixture.disconnect()"
    );
    await page.getByText("Offline · Current host facts", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Trust this checkout", exact: true }).count(),
      0
    );
    await page.screenshot({ path: join(output, "offline.png") });
    await page.evaluate("window.integrationFixture.reconnect()");
    await page
      .getByText("This worktree inherits its workspace's trust.", { exact: false })
      .waitFor();

    await page.getByRole("switch", { name: "Format on save" }).click();
    await page.evaluate("window.integrationFixture.control.hold=true");
    await page.getByRole("button", { name: "Save language settings", exact: true }).click();
    await page.getByRole("button", { name: "Cancel request", exact: true }).click();
    await page.evaluate("window.integrationFixture.control.hold=false");
    await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
    await page.getByText(/current observed revision 1/).waitFor();
    assert.equal(
      await page.getByRole("switch", { name: "Format on save" }).getAttribute("aria-checked"),
      "true"
    );
    await page.evaluate("window.integrationFixture.control.release()");
    await page.waitForFunction("[...window.integrationFixture.records.values()][0].revision === 2");
    await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Settings changed on this Client" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Save language settings", exact: true }).isDisabled(),
      true
    );
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await page.getByRole("switch", { name: "Format on save" }).click();
    await page.evaluate(
      "window.integrationFixture.control.fail=true;window.integrationFixture.disconnect()"
    );
    await page.getByRole("status").filter({ hasText: "Last-known facts" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Save language settings", exact: true }).isDisabled(),
      true
    );
    assert.equal(
      await page.getByRole("button", { name: "Trust this checkout", exact: true }).isDisabled(),
      true
    );
    await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
    await page
      .getByText("Couldn't load language settings. Refresh facts to retry.", { exact: true })
      .waitFor();
    await page.evaluate(
      "window.integrationFixture.control.fail=false;window.integrationFixture.reconnect()"
    );
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await page.setViewportSize({ width: 760, height: 900 });

    const geometry = () =>
      page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("main,nav,[data-section]")].map((el) => ({
          tag: el.tagName,
          width: el.getBoundingClientRect().width,
          minWidth: getComputedStyle(el).minWidth,
        })),
      }));

    await page.getByTestId("settings").evaluate((el) => el.classList.remove("min-w-0"));
    const before = await geometry();
    await page.screenshot({ path: join(output, "narrow-before.png") });
    await page.getByTestId("settings").evaluate((el) => el.classList.add("min-w-0"));
    const after = await geometry();
    await writeFile(
      join(output, "narrow-geometry.json"),
      JSON.stringify({ before, after }, null, 2)
    );
    assert.equal(before.document > before.viewport, true);
    assert.equal(after.document > after.viewport, false);
    await page.screenshot({ path: join(output, "narrow.png") });

    const evidence = await page.evaluate(
      "({calls:window.integrationFixture.control.calls,refreshes:window.integrationFixture.refreshes,records:[...window.integrationFixture.records.values()]})"
    );

    assert.deepEqual(errors, []);
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(
        { errors, evidence, screenshots: 8, themes: 2, densities: 3, fakeOnly: true },
        null,
        2
      )
    );
  }
} catch (error) {
  if (failurePage) {
    await failurePage.screenshot({ path: join(output, "failure.png") });
    await writeFile(join(output, "failure.html"), await failurePage.content());
  }

  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ errors, failure: String(error) }, null, 2)
  );
  throw error;
} finally {
  if (app) await app.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
