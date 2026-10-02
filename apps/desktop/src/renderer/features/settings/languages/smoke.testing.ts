import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { _electron } from "playwright-core";
import { Schema } from "effect";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass a temporary evidence directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-u0-render-"));

const server = await createServer({
  configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
  root: import.meta.dirname,
  cacheDir: join(temporary, "vite-cache"),
  server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
});

await server.listen();

const address = server.resolvedUrls?.local[0];

if (!address) throw new Error("No fixture address");

const entry = join(temporary, "main.cjs");

await writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, "user-data"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:960,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}evidence.html`)});});`
);

const app = await _electron.launch({ executablePath: stockElectronBinary(), args: [entry] });

const errors: Array<string> = [];

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Language integrations", exact: true }).waitFor();
  await page.getByLabel("Server ID", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("switch", { name: "Format on save" }).getAttribute("aria-checked"),
    "true"
  );

  for (const theme of ["dark", "light"]) {
    for (const density of ["calm", "balanced", "compact"]) {
      await page.evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.density=${JSON.stringify(density)};document.documentElement.dataset.reduceMotion='true';document.documentElement.dataset.diffPalette='cvd'`
      );
      await page.getByLabel("Settings scope").focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Refresh facts", exact: true })
          .evaluate((el) => el === document.activeElement),
        true
      );

      const ring = await page
        .getByRole("button", { name: "Refresh facts", exact: true })
        .evaluate((el) => getComputedStyle(el).outlineStyle);

      assert.notEqual(ring, "none");
      await page.screenshot({ path: join(output, `${theme}-${density}.png`) });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );

      assert.equal(overflow, false);
    }
  }

  await page.getByLabel("One formatter").selectOption("ruff");
  assert.equal(await page.getByLabel("Settings scope").isDisabled(), true);
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByLabel("One formatter").selectOption("none");
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByLabel("Server ID", { exact: true }).fill("custom-fixture");
  await page.getByLabel("Executable on host", { exact: true }).fill("/fixture/lsp");
  await page.getByLabel("Document language ID", { exact: true }).fill("python");
  await page.getByLabel("Arguments (JSON string array)", { exact: true }).fill('["--stdio"]');
  await page
    .getByLabel("Environment (private JSON object)", { exact: true })
    .fill('{"BAD-NAME":"FAKE_PRIVATE_VALUE"}');
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Environment names" }).waitFor();
  assert.equal(
    await page
      .getByRole("alert")
      .innerText()
      .then((s) => s.includes("FAKE_PRIVATE_VALUE")),
    false
  );
  await page
    .getByLabel("Environment (private JSON object)", { exact: true })
    .fill('{"FAKE_KEY":"FAKE_PRIVATE_VALUE"}');
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit custom-fixture", exact: true }).waitFor();
  await page
    .getByRole("checkbox", { name: "custom-fixture · custom stdio server", exact: true })
    .check();
  await page.getByLabel("One formatter").selectOption("custom:custom-fixture");
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit custom-fixture", exact: true }).waitFor();

  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake host 1");
  await page.getByRole("button", { name: "Reconnect host", exact: true }).click();
  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake host 10");
  await page.getByText("audit-required · Artifact audit is incomplete", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Install", exact: true }).count(), 0);
  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake host 9");
  await page.getByText("missing-prerequisite · Python is missing", { exact: true }).waitFor();

  for (const [host, action] of [
    ["Fake host 5", "Install"],
    ["Fake host 6", "Retry"],
    ["Fake host 6", "Roll back to 1.0.0"],
    ["Fake host 8", "Update"],
    ["Fake host 7", "Cancel installation"],
    ["Fake host 0", "Restart"],
  ] as const) {
    await page
      .getByLabel("Find host or tool", { exact: true })
      .fill(host === "Fake host 0" ? "Fake host 12" : host);
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.getByLabel("Server ID", { exact: true }).waitFor();
  }

  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake host 12");
  await page
    .getByText(
      "This review checkout needs its own explicit trust; workspace trust does not apply. Syntax stays available.",
      { exact: true }
    )
    .waitFor();
  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake Linux VM");
  await page
    .getByText("This worktree inherits its workspace's trust. Syntax stays available.", {
      exact: true,
    })
    .waitFor();
  await page.evaluate("window.fixture.control.hold=true");
  await page.getByRole("button", { name: "Trust this checkout", exact: true }).click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "may already have completed" }).waitFor();
  await page.evaluate("window.fixture.control.hold=false;window.fixture.control.fail=true");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fake host request failed" }).waitFor();
  await page.evaluate("window.fixture.control.fail=false");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page.getByLabel("Server ID", { exact: true }).waitFor();
  await page.setViewportSize({ width: 440, height: 850 });
  await page.getByLabel("Find host or tool", { exact: true }).fill("Fake Linux VM");
  await page
    .getByText("This worktree inherits its workspace's trust. Syntax stays available.", {
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false
  );
  await page.screenshot({ path: join(output, "narrow-host.png") });

  const result = Schema.decodeUnknownSync(
    Schema.Struct({ calls: Schema.Array(Schema.String), aborted: Schema.Number })
  )(await page.evaluate("({calls:window.fixture.calls,aborted:window.fixture.control.aborted})"));

  assert(result.aborted >= 1);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        themes: 2,
        densities: 3,
        screenshots: 7,
        keyboard: true,
        narrow: true,
        cancellation: true,
        errors,
        ...result,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ output, errors, calls: result.calls.length, aborted: result.aborted })
  );
} finally {
  await app.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
