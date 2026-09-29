#!/usr/bin/env bun
/**
 * Builds the Desktop App into `out/`: the renderer with Vite (React Compiler,
 * Tailwind), the main process and the preload with Bun.build, then an unpacked
 * `out/Polaris.app` on macOS. Packaging and signing come later.
 *
 *   bun scripts/build.ts            everything
 *   bun scripts/build.ts --no-app   skip the .app (dev and smoke tests run `electron .`)
 */
import { buildMain, buildRenderer, bundleApp } from "./lib/build.ts";

const started = performance.now();

await buildRenderer();

await buildMain();

if (!process.argv.includes("--no-app") && process.platform === "darwin") {
  console.log(`built ${await bundleApp()}`);
}

console.log(`desktop build done in ${Math.round(performance.now() - started)} ms`);
