import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Schema } from "effect";
import {
  createServer,
  type ViteDevServer,
} from "../../../apps/desktop/node_modules/vite/dist/node/index.js";
import playwright, {
  type ElectronApplication,
  type Page,
} from "../../../apps/desktop/node_modules/playwright-core/index.js";

const { _electron } = playwright;

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { bounds, cases } from "./manifest.ts";
import { fixtureHtml } from "./html.ts";
import * as assertions from "./assertions.ts";

const root = resolve(import.meta.dirname, "../../..");

const output = process.argv[2];

const temporary = process.argv[3];

if (!output || !temporary) throw new Error("Use run.ts: owned output/root arguments required");

const json = <T>(name: string, value: T) =>
  writeFile(join(output, name), JSON.stringify(value, null, 2));

const expected = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
  JSON.parse(await readFile(join(import.meta.dirname, "sources.json"), "utf8"))
);

const actual: Record<string, string> = {};

for (const [path, hash] of Object.entries(expected)) {
  actual[path] = createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
  assert.equal(actual[path], hash, `Frozen fixture changed: ${path}`);
}

await json("source-binding.json", {
  root,
  fixtures: actual,
  configuration: await Promise.all(
    ["bun.lock", "package.json", "apps/desktop/package.json", "apps/desktop/vite.config.ts"].map(
      async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(join(root, path)))
          .digest("hex"),
      })
    )
  ),
});

const server = await createServer({
  configFile: join(root, "apps/desktop/vite.config.ts"),
  root,
  resolve: {
    alias: {
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
  },
  cacheDir: join(temporary, "vite"),
  server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
  plugins: [
    {
      name: "joint-existing-fixtures",
      configureServer: (vite: ViteDevServer) => {
        vite.middlewares.use((request, response, next) => {
          const entry = cases.find((c) => request.url === `/joint/${c.id}.html`);

          if (!entry) return next();
          void readFile(join(root, entry.html), "utf8")
            .then((source) =>
              vite.transformIndexHtml(
                `/joint/${entry.id}.html`,
                fixtureHtml(source, entry.html, entry.id === "resources")
              )
            )
            .then((html) => {
              response.setHeader("Content-Type", "text/html");
              response.end(html);
            })
            .catch(next);
        });
      },
    },
  ],
});

let app: ElectronApplication | undefined;

let page: Page | undefined;

let stage = "setup";

const errors: Array<{ stage: string; message: string }> = [];

const blocked: string[] = [];

const results: Array<unknown> = [];

const bounded = async <T>(task: Promise<T>, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Bound exceeded: ${label}`)), bounds.caseMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

try {
  await server.listen();
  const address = server.resolvedUrls?.local[0];

  if (!address) throw new Error("No joint fixture loopback address");
  const entry = join(temporary, "main.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(()=>{new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}}).loadURL('about:blank');});`
  );
  const require = createRequire(join(root, "apps/desktop/package.json"));
  const electron = Schema.decodeUnknownSync(Schema.String)(require("electron"));

  if (!existsSync(electron))
    throw new Error("Existing Electron binary unavailable; no automatic download");
  app = await _electron.launch({
    executablePath: electron,
    args: [entry],
    timeout: bounds.launchMs,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(bounds.actionMs);
  page.setDefaultNavigationTimeout(bounds.navigationMs);
  page.on("pageerror", (error) => errors.push({ stage, message: error.message }));
  const origin = new URL(address).origin;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());

    if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:")
      return route.continue();
    blocked.push(url.origin);

    return route.abort();
  });

  for (const entry of cases) {
    stage = entry.id;
    const target = join(output, entry.id);
    await mkdir(target);
    const ownedPage = page;
    const started = Date.now();

    const evidence = await bounded(
      (async () => {
        await ownedPage.goto(`${address}joint/${entry.id}.html`);

        return assertions[entry.id](ownedPage, target);
      })(),
      entry.id
    );

    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    await page.screenshot({ path: join(target, "complete.png") });

    const result = {
      id: entry.id,
      elapsedMs: Date.now() - started,
      classification: entry.classification,
      evidence,
    };

    await json(`${entry.id}/result.json`, result);
    results.push(result);
    await page.goto("about:blank");
  }

  await json("result.json", {
    results,
    errors,
    blocked,
    electronLaunches: 1,
    measurements: [],
    status: "passed",
  });
} catch (cause) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    await writeFile(join(output, "failure.html"), await page.content()).catch(() => {});
  }

  await json("failure.json", { stage, cause: String(cause), errors, blocked, completed: results });
  throw cause;
} finally {
  try {
    await app?.close();
  } finally {
    await server.close();
  }
}
