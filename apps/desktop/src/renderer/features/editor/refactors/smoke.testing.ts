import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, loadavg } from "node:os";
import { createServer } from "vite";
import { _electron, type ElectronApplication } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";

const output = process.argv[2];

if (!output) throw new Error("Pass an evidence directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-r1-electron-"));

await writeFile(join(output, "owned-root.json"), JSON.stringify({ temporary }));

const errors: string[] = [];

const facts: string[] = [];

let app: ElectronApplication | null = null;

let server: Awaited<ReturnType<typeof createServer>> | null = null;

try {
  server = await createServer({
    configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
    root: import.meta.dirname,
    cacheDir: join(temporary, "vite"),
    server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
  });
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("Fixture server unavailable");
  const url = `${address}evidence.html`;
  const main = join(temporary, "main.cjs");
  await writeFile(
    main,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(url)});});`
  );
  app = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()
  );
  await page.waitForFunction("window.refactorProof !== undefined");

  if (process.argv.includes("--resources-only")) {
    facts.push(...(await page.evaluate<string[]>("window.resourceProof.collision()")));
    await page.evaluate("window.resourceProof.offer()");

    try {
      await page.getByText("1. create file:///checkout/created", { exact: true }).waitFor();
    } catch (cause) {
      await page.screenshot({ path: join(output, "resource-failure.png") });
      await writeFile(
        join(output, "resource-failure.json"),
        JSON.stringify({ body: await page.locator("body").innerText(), errors }, null, 2)
      );
      throw cause;
    }

    const body = await page.locator("body").innerText();

    for (const operation of ["1. create", "2. rename", "3. delete", "Preserved original draft"])
      assert.ok(body.includes(operation), operation);
    await page.screenshot({ path: join(output, "resource-preview.png") });
    await page.getByRole("button", { name: "Accept refactor", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "partial:" }).waitFor();
    facts.push(...(await page.evaluate<string[]>("window.resourceProof.accepted(true)")));
    await page.screenshot({ path: join(output, "resource-partial.png") });
    await page.getByRole("button", { name: "Recover file operations", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "restored:" }).waitFor();
    facts.push(...(await page.evaluate<string[]>('window.resourceProof.restored("recover")')));
    await page.evaluate("window.resourceProof.offer(true)");
    await page.getByRole("button", { name: "Accept refactor", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "applied:" }).waitFor();
    facts.push(...(await page.evaluate<string[]>("window.resourceProof.accepted(false)")));
    await page.getByRole("button", { name: "Undo refactor", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "restored:" }).waitFor();
    facts.push(...(await page.evaluate<string[]>('window.resourceProof.restored("undo")')));
    assert.deepEqual(errors, []);
    await writeFile(
      join(output, "evidence.json"),
      JSON.stringify(
        {
          facts: [...new Set(facts)],
          errors,
          samples: [],
          limits:
            "Fake typed Host outcomes; actual UI and strict IndexedDB reopened readback. No production RPC/filesystem proof or repeated measurement.",
        },
        null,
        2
      )
    );
  } else {
    await page.evaluate("window.refactorProof.offer()");

    for (const theme of ["dark", "light"] satisfies ("dark" | "light")[])
      for (const density of ["calm", "balanced", "compact"]) {
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await page.evaluate(
          ({ theme, density }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.density = density;
            document.documentElement.dataset.diffPalette = "colourblind";
          },
          { theme, density }
        );
        await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
      }

    await page.getByRole("button", { name: "Accept refactor", exact: true }).click();
    await page.getByRole("button", { name: "Undo refactor", exact: true }).waitFor();
    facts.push(...(await page.evaluate<string[]>("window.refactorProof.accepted()")));
    await page.evaluate("window.refactorProof.abort()");
    await page.evaluate("window.refactorProof.quota()");
    await page.evaluate("window.refactorProof.strict()");
    facts.splice(
      0,
      facts.length,
      ...(await page.evaluate<string[]>("window.refactorProof.facts()"))
    );
    await page.evaluate("void window.refactorProof.crash().catch(()=>{})");
    await page.waitForFunction("window.refactorProof.crashReady");
    await writeFile(join(output, "before-crash.json"), JSON.stringify({ facts, errors }));
    const killed = app.process();
    const exited = new Promise<void>((resolve) => killed.once("exit", () => resolve()));
    killed.kill("SIGKILL");
    await exited;
    app = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction("window.refactorProof !== undefined");

    const reopened = await page.evaluate<{ facts: string[]; id: string; revision: number }>(
      "window.refactorProof.reopened()"
    );

    facts.push(...reopened.facts);
    await writeFile(join(output, "after-crash.json"), JSON.stringify({ facts, errors, reopened }));
    await page.getByRole("button", { name: "Undo refactor", exact: true }).click();
    await page.waitForFunction("window.refactorProof.facts() !== undefined");
    const undoState = await page.evaluate("document.querySelector('[role=status]')?.textContent");
    await writeFile(
      join(output, "undo-observation.json"),
      JSON.stringify({ undoState, body: await page.locator("body").innerText() })
    );
    await page.getByRole("status").filter({ hasText: "restored:" }).waitFor();
    facts.push("Actual Undo button restores durable original draft");
    await page.evaluate("window.refactorProof.offer()");
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await page.getByRole("button", { name: "Reject", exact: true }).waitFor({ state: "detached" });
    facts.push("Actual Reject button creates no acceptance");
    facts.push(...(await page.evaluate<string[]>("window.refactorProof.runtime()")));
    facts.push(...(await page.evaluate<string[]>("window.refactorProof.unknownAndStale()")));
    const samples = await page.evaluate("window.refactorProof.measure()");
    assert.deepEqual(errors, []);
    await writeFile(
      join(output, "evidence.json"),
      JSON.stringify(
        {
          facts,
          errors,
          reopened,
          samples,
          load: loadavg(),
          limits:
            "Fake Host/services; actual isolated Electron/IndexedDB/CodeMirror; injected quota exception, actual transaction rollback and isolated Electron SIGKILL. Tiny persistence controls do not certify production transport or whole-App budgets.",
        },
        null,
        2
      )
    );
  }
} finally {
  try {
    await app?.close();
  } finally {
    await server?.close();
    await rm(temporary, { recursive: true, force: true });
  }

  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify({ temporaryRemoved: true, profile: temporary })
  );
}
