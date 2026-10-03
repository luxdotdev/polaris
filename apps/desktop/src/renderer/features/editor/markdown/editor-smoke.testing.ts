import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, loadavg } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { _electron } from "playwright-core";
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

const metrics: Record<string, Array<number>> = {};

try {
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("Fixture server unavailable");
  const entry = join(temporary, "main.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, "user-data"))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1050,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}editor-evidence.html`)});});`
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
  await page.locator(".cm-content").waitFor();
  assert.equal(await page.locator('[data-view="markdown"]').count(), 0);
  assert.equal(
    await page.evaluate(
      "performance.getEntriesByType('resource').some(e=>/Rendered.tsx|streamdown|shiki|mermaid.*chunk/.test(e.name))"
    ),
    false
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Meta+Shift+V");
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 2);
  assert.equal(await page.locator("table").count(), 1);
  await page.locator('img[alt="Local"]').evaluate(async (node) => {
    if (node instanceof HTMLImageElement) await node.decode();
  });
  assert.equal(
    await page.evaluate(
      "window.fixture.calls.filter(c=>c.method==='languages.preview.external').length"
    ),
    0
  );
  await page.getByRole("button", { name: "Load external images" }).click();
  await page.locator('img[alt="External"]').waitFor();
  await page.locator('img[alt="External"]').evaluate(async (node) => {
    if (node instanceof HTMLImageElement) await node.decode();
  });
  await page.evaluate(
    "window.fixture.replace('# Unsaved source\\n\\n[Jump](#unsaved-source)\\n\\n![Local](tiny.png)')"
  );
  await page.getByRole("heading", { name: "Unsaved source" }).waitFor();
  await page.getByRole("link", { name: "Jump", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate("document.activeElement.id"), "preview-unsaved-source");
  const before = await page.evaluate("window.fixture.snapshot()");
  await page.evaluate("window.fixture.source()");
  await page.locator(".cm-content").waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /Unsaved source/);
  await page.evaluate("window.fixture.undo()");
  await page.evaluate("window.fixture.preview()");
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  await page.getByRole("button", { name: "Lock to document" }).click();
  await page.evaluate("window.fixture.open('/fixture/docs/b.md')");
  await page.locator(".cm-content").waitFor();
  await page.keyboard.press("Meta+Shift+V");
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  await page.getByRole("button", { name: "Unlock preview" }).click();
  await page.evaluate("window.fixture.open('/fixture/docs/b.md')");
  await page.keyboard.press("Meta+Shift+V");
  await page.getByRole("heading", { name: "Guide", exact: true }).waitFor();
  await page.evaluate("window.fixture.open('/fixture/code.ts')");
  await page.locator(".cm-content").waitFor();
  await page.keyboard.press("Meta+Shift+V");
  assert.equal(await page.locator("[data-testid=editor-markdown-preview]").count(), 0);
  await page.evaluate("window.fixture.open('/fixture/docs/a.md'); window.fixture.preview()");
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /Guide text/);
  await page.evaluate("window.fixture.open('/fixture/docs/a.md'); window.fixture.preview()");
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  await page.evaluate("window.fixture.offline(true)");
  await page.getByText("Images unavailable on Fake Linux", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Original source" }).waitFor();
  await page.waitForFunction(
    "window.fixture.created.length > 0 && window.fixture.created.length === window.fixture.revoked.length"
  );
  await page.evaluate("window.fixture.offline(false)");
  await page.locator('img[alt="Local"]').waitFor();
  await page.evaluate("window.fixture.oldHost(true)");
  await page.getByText("Images unavailable on Fake Linux", { exact: true }).waitFor();
  await page.waitForFunction(
    "window.fixture.created.length > 0 && window.fixture.created.length === window.fixture.revoked.length"
  );
  await page.evaluate("window.fixture.oldHost(false)");
  await page.locator('img[alt="Local"]').waitFor();

  // Measure source/preview switching in one renderer; this is a fixture control, not a historical baseline.
  for (let run = 0; run < 3; run++) {
    const sourceStart = performance.now();
    await page.evaluate("window.fixture.source()");
    await page.locator(".cm-content").waitFor();
    (metrics["source-switch-ms"] ??= []).push(performance.now() - sourceStart);
    const previewStart = performance.now();
    await page.evaluate("window.fixture.preview()");
    await page.getByRole("heading", { name: "Original source" }).waitFor();
    (metrics["preview-switch-ms"] ??= []).push(performance.now() - previewStart);
  }

  for (const theme of ["dark", "light"])
    for (const density of ["calm", "balanced", "compact"]) {
      await page.evaluate(
        ({ theme, density }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.density = density;
          document.documentElement.dataset.diffPalette = "cvd";
        },
        { theme, density }
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: "Lock to document" }).focus();
      await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
      assert.equal(
        await page
          .locator(".markdown-preview")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true
      );
    }

  await page.evaluate(
    "window.fixture.replace('# Draft before restart'); window.fixture.close('/fixture/docs/a.md')"
  );
  await page.getByRole("heading", { name: "Draft before restart" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.waitForFunction(
    "Object.values(window.fixture.snapshot().persisted).some(s=>s.activeView==='markdown' && !s.tabs.some(t=>t.path==='/fixture/docs/a.md' && !t.view))"
  );

  const mediaBeforeRestart = await page.evaluate(
    "({created:window.fixture.created,revoked:window.fixture.revoked})"
  );

  await page.reload();
  await page.getByRole("heading", { name: "Draft before restart" }).waitFor();
  assert.equal(
    await page.evaluate(
      "window.fixture.snapshot().dirty.filter(k=>k.endsWith('/fixture/docs/a.md')).length"
    ),
    1
  );
  await page.evaluate("window.fixture.close('markdown-preview')");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("heading", { name: "Draft before restart" }).waitFor();
  await page.evaluate("window.fixture.close('markdown-preview')");
  await page.getByRole("button", { name: "Don't save", exact: true }).click();
  await page.waitForFunction("window.fixture.created.length===window.fixture.revoked.length");
  assert.equal(requests.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(
      {
        before,
        mediaBeforeRestart,
        final: await page.evaluate("window.fixture.snapshot()"),
        calls: await page.evaluate("window.fixture.calls"),
        created: await page.evaluate("window.fixture.created"),
        revoked: await page.evaluate("window.fixture.revoked"),
        errors,
        requests,
        metrics,
        load: loadavg(),
        temporary,
      },
      null,
      2
    )
  );
  console.error("M2 actual Editor fixture passed; screenshots and evidence retained");
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
