/**
 * Fails when a package `ray build` shared into `<out>/node_modules` requires a
 * specifier its generated manifest doesn't export (ENG-456).
 *
 *   node scripts/checkShared.mjs <out dir>
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "dist");

const modules = join(out, "node_modules");

const require = createRequire(join(out, "index.js"));

const specifiers = new Set();

for (const file of readdirSync(modules, { recursive: true, encoding: "utf8" })) {
  if (!file.endsWith(".js")) continue;

  for (const match of readFileSync(join(modules, file), "utf8").matchAll(
    /require\("([^".][^"]*)"\)/g
  ))
    specifiers.add(match[1]);
}

const missing = [...specifiers].filter((specifier) => {
  if (specifier.startsWith("node:") || specifier === "@raycast/api" || specifier === "react")
    return false;

  try {
    require.resolve(specifier);

    return false;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.error(`shared packages require what they don't export: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`${specifiers.size} shared specifiers resolve`);
