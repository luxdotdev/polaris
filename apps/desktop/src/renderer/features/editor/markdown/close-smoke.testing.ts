import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import type { TabSet } from "../model/tabs.ts";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass evidence directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-m2-electron-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(temporary, "vite-cache"),
  server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
});

let app: Awaited<ReturnType<typeof _electron.launch>> | null = null;

const errors: Array<string> = [];

const requests: Array<string> = [];

try {
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("Fixture server unavailable");
  const entry = join(temporary, "main.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, "user-data"))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1050,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}editor-evidence.html?close-race=1`)});});`
  );
  app = await _electron.launch({ executablePath: stockElectronBinary(), args: [entry] });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());

    if (url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol))
      return route.continue();
    requests.push(url.href);

    return route.abort();
  });
  const facts = [];

  for (const phase of ["format", "write"]) {
    for (const change of ["follow", "reopen", "ordinary", "failed"]) {
      await page.evaluate("localStorage.clear()");
      await page.reload();
      await page.locator(".cm-content").waitFor();
      await page.evaluate("window.fixture.preview()");
      await page.getByRole("heading", { name: "Original source" }).waitFor();
      await page.evaluate(
        "window.fixture.close('/fixture/docs/a.md'); window.fixture.replace('# Dirty A')"
      );
      await page.getByRole("heading", { name: "Dirty A" }).waitFor();
      await page.evaluate(
        `window.fixture.holdSave(${JSON.stringify(phase)}, ${change === "failed"})`
      );
      await page.evaluate("window.fixture.close('markdown-preview')");
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction("window.fixture.saveEntered()");

      if (change === "follow") {
        await page.evaluate("window.fixture.open('/fixture/docs/b.md'); window.fixture.preview()");
        await page.getByRole("heading", { name: "Guide", exact: true }).waitFor();
      }

      if (change === "reopen") {
        await page.evaluate(
          "window.fixture.open('/fixture/docs/a.md'); window.fixture.close('markdown-preview'); window.fixture.preview()"
        );
        await page.getByRole("heading", { name: "Dirty A" }).waitFor();
      }

      await page.evaluate("window.fixture.settleSave()");

      const snapshot = await page.evaluate<{
        tabs: TabSet;
        dirty: string[];
        text: string | undefined;
      }>("window.fixture.snapshot()");

      const preview = snapshot.tabs.tabs.find(
        (t: { view?: string; path: string }) => t.view === "markdown"
      );

      if (change === "ordinary") {
        assert.equal(preview, undefined);
      } else {
        assert.equal(
          preview?.path,
          change === "follow" ? "/fixture/docs/b.md" : "/fixture/docs/a.md",
          `${phase}/${change}`
        );
        assert.equal(await page.evaluate("window.fixture.sameView()"), true);
        assert.equal(snapshot.text, "# Dirty A");
        assert.equal(
          snapshot.dirty.includes("fake-linux\u0000/fixture/docs/a.md"),
          change === "failed"
        );

        if (change !== "failed") {
          assert.equal(await page.evaluate("window.fixture.diskA()"), "# Dirty A");
          await page.evaluate("window.fixture.undo()");
          assert.match(await page.evaluate("window.fixture.snapshot().text"), /Original source/);
          assert.equal(await page.evaluate("window.fixture.sameView()"), true);
        }
      }

      facts.push({ phase, change, snapshot });
    }
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(
    join(output, "close-evidence.json"),
    JSON.stringify({ facts, errors, requests, temporary }, null, 2)
  );
  await page.screenshot({ path: join(output, "close-final.png") });
  console.error(
    "8 actual Editor held-format/write close cases passed; retarget/reopen/ordinary/failed with live buffer and undo"
  );
} catch (error) {
  const page = app === null ? null : app.windows()[0];

  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ errors, requests, body: await page?.locator("body").innerText() }, null, 2)
  );
  await page?.screenshot({ path: join(output, "failure.png") });
  throw error;
} finally {
  await app?.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
  console.error("M2 own Electron/server/profile/cache cleaned");
}
