import { Schema } from "effect";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, loadavg } from "node:os";
import { createServer } from "vite";
import { _electron, type ElectronApplication } from "playwright-core";
import { stockElectronBinary } from "../../../../../scripts/lib/electron.ts";
import type { SaveProofControls } from "./proofTypes.ts";

const output = process.argv[2];

const visualOnly = process.argv[3] === "--visual-only";

if (!output) throw new Error("Pass an evidence directory");

await mkdir(output, { recursive: true });

const temporary = await mkdtemp(join(tmpdir(), "m31-f2-electron-"));

const accepted = execFileSync(
  "git",
  ["show", "4710ae39:apps/desktop/src/renderer/features/editor/runtime/buffers.ts"],
  { encoding: "utf8" }
);

const Proof = Schema.Struct({
  facts: Schema.Array(Schema.String),
  calls: Schema.Array(Schema.String),
  disk: Schema.NullOr(Schema.String),
  watches: Schema.Number,
});

interface ModeEvidence {
  readonly proof: typeof Proof.Type | null;
  readonly samples: Record<string, number[]>;
  readonly errors: string[];
  readonly finalWatches: number;
  readonly controlLoads: number;
}

const modes: Record<string, ModeEvidence> = {};

const evidence = {
  base: "4710ae39",
  visualOnly,
  acceptedBufferSHA256: createHash("sha256").update(accepted).digest("hex"),
  node: process.version,
  load: loadavg(),
  modes,
};

try {
  for (const mode of visualOnly ? ["candidate"] : ["accepted", "candidate"]) {
    let controlLoads = 0;

    const server = await createServer({
      configFile: join(import.meta.dirname, "../../../../../vite.config.ts"),
      root: import.meta.dirname,
      cacheDir: join(temporary, mode),
      plugins: [
        {
          name: "accepted-buffer-control",
          enforce: "pre",
          load: (id) => {
            if (mode !== "accepted" || !id.endsWith("/editor/runtime/buffers.ts")) return null;
            controlLoads++;

            return accepted;
          },
        },
      ],
      server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false, watch: null },
    });

    let launched: ElectronApplication | null = null;

    try {
      await server.listen();
      const address = server.resolvedUrls?.local[0];

      if (!address) throw new Error("Fixture server unavailable");
      const main = join(temporary, `${mode}.cjs`);

      await writeFile(
        main,
        `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, `${mode}-data`))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:720,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadURL(${JSON.stringify(`${address}evidence.html`)});});`
      );
      const app = await _electron.launch({ executablePath: stockElectronBinary(), args: [main] });
      launched = app;
      const errors: string[] = [];
      const page = await app.firstWindow();

      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());

        return url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:"
          ? route.continue()
          : route.abort();
      });
      await page.waitForFunction("window.saveProof !== undefined");
      let proof: typeof Proof.Type | null = null;

      if (mode === "candidate") {
        proof = Schema.decodeUnknownSync(Proof)(await page.evaluate("window.saveProof.run()"));
        await page.getByText("Saving unformatted: main.ts").first().waitFor();
        await page
          .getByText(
            "The selected formatter is unavailable on this Host. Saving your text without formatting."
          )
          .waitFor();

        for (const theme of ["dark", "light"] satisfies ("dark" | "light")[])
          for (const density of ["calm", "balanced", "compact"]) {
            await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
            await page.evaluate(
              ({ theme, density }) => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.density = density;
                document.documentElement.dataset.motion = "reduce";
                document.documentElement.dataset.diffPalette = "colourblind";
              },
              { theme, density }
            );
            await page.screenshot({ path: join(output, `${theme}-${density}.png`) });
          }
      }

      const samples = visualOnly
        ? {}
        : await page.evaluate(async () => {
            const result: Record<string, number[]> = {};

            for (const enabled of [false, true]) {
              const fixture: SaveProofControls = window.saveProof;

              fixture.enable(enabled);
              const times: number[] = [];

              for (let n = 0; n < 16; n++) {
                await fixture.edit(`sample ${enabled} ${n}`);
                const start = performance.now();

                if (!(await fixture.save())) throw new Error("Measured save failed");

                if (n > 0) times.push(performance.now() - start);
              }

              result[String(enabled)] = times;
            }

            return result;
          });

      const watches = await page.evaluate("window.saveProof.cleanup()");

      assert.equal(watches, 0);
      assert.deepEqual(errors, []);
      assert.equal(controlLoads > 0, mode === "accepted");
      modes[mode] = { proof, samples, errors, finalWatches: watches, controlLoads };
    } finally {
      try {
        await launched?.close();
      } finally {
        await server.close();
      }
    }
  }

  evidence.modes = modes;
  await writeFile(join(output, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`Save proof and accepted/candidate samples retained in ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
