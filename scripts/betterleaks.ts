#!/usr/bin/env bun
/**
 * The Betterleaks binary that ships beside `polaris`, outside npm.
 *
 *   bun scripts/betterleaks.ts fetch [platform…]   download and verify the pinned binaries
 *   bun scripts/betterleaks.ts audit               re-audit the Go modules compiled into it
 *
 * `audit` reads the module list from the pinned binary (`go version -m`, so it
 * needs Go), fetches each module's licence from the Go module proxy, and
 * writes `scripts/betterleaks-licenses.json`. `licenses.ts --check` enforces
 * the allowlist on that file and puts its texts in THIRD_PARTY_NOTICES.md.
 * Run it on every version bump (`apps/daemon/src/rules/secrets/pin.ts`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedBetterleaks,
  fetchBetterleaks,
  hostAsset,
} from "../apps/daemon/src/rules/secrets/fetch.ts";
import {
  BETTERLEAKS_ASSETS,
  BETTERLEAKS_VERSION,
  betterleaksAsset,
} from "../apps/daemon/src/rules/secrets/pin.ts";
import { classifyLicense, type GoModuleLicense } from "./goLicenses.ts";

const auditPath = join(import.meta.dir, "betterleaks-licenses.json");

const run = async (argv: ReadonlyArray<string>): Promise<string> => {
  const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}: ${stderr.trim()}`);

  return stdout;
};

/** The module proxy's case encoding: each capital letter becomes `!` plus its lower case. */
const escapeModule = (path: string) => path.replaceAll(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

const LICENSE_FILE = /^(licen[cs]e|copying)(\.md|\.txt)?$/i;

/** A dual-licensed module (`LICENSE-MIT` and `LICENSE-APACHE`) is taken under MIT. */
const DUAL_LICENSE_FILE = /^licen[cs]e-mit(\.md|\.txt)?$/i;

const moduleLicense = async (path: string, version: string): Promise<string> => {
  const url = `https://proxy.golang.org/${escapeModule(path)}/@v/${version}.zip`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const dir = mkdtempSync(join(tmpdir(), "polaris-golicense-"));

  try {
    const zip = join(dir, "module.zip");
    writeFileSync(zip, new Uint8Array(await response.arrayBuffer()));
    await run(["unzip", "-q", zip, "-d", dir]);
    const root = join(dir, `${path}@${version}`);
    const names = readdirSync(root);

    const file =
      names.find((name) => LICENSE_FILE.test(name)) ??
      names.find((name) => DUAL_LICENSE_FILE.test(name));

    if (file === undefined) throw new Error(`${path}@${version} has no licence file at its root`);

    return readFileSync(join(root, file), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const goLicense = async (goVersion: string): Promise<string> => {
  const response = await fetch(`https://raw.githubusercontent.com/golang/go/${goVersion}/LICENSE`);

  if (!response.ok) throw new Error(`Go ${goVersion} LICENSE: HTTP ${response.status}`);

  return response.text();
};

const audit = async () => {
  const asset = hostAsset() ?? "linux-x64";
  const binary = await fetchBetterleaks(asset);
  const info = await run(["go", "version", "-m", binary]);
  const goVersion = /:\s+(go[\d.]+)/.exec(info)?.[1];

  if (goVersion === undefined) throw new Error(`no Go version in go version -m output`);

  const deps = [...info.matchAll(/^\s+dep\s+(\S+)\s+(\S+)/gm)].map((m) => ({
    path: m[1]!,
    version: m[2]!,
  }));

  const modules: Array<GoModuleLicense> = [];

  const betterleaksText = await (
    await fetch(
      `https://raw.githubusercontent.com/betterleaks/betterleaks/v${BETTERLEAKS_VERSION}/LICENSE`
    )
  ).text();

  modules.push({
    path: "github.com/betterleaks/betterleaks/v2",
    version: `v${BETTERLEAKS_VERSION}`,
    license: classifyLicense(betterleaksText),
    text: betterleaksText,
  });

  const stdlib = await goLicense(goVersion);
  modules.push({
    path: "Go standard library",
    version: goVersion,
    license: classifyLicense(stdlib),
    text: stdlib,
  });

  for (const dep of deps.filter((d) => d.version !== "(devel)")) {
    const text = await moduleLicense(dep.path, dep.version);
    modules.push({ ...dep, license: classifyLicense(text), text });
    console.log(`${dep.path}@${dep.version}: ${modules.at(-1)!.license ?? "UNKNOWN"}`);
  }

  writeFileSync(
    auditPath,
    `${JSON.stringify({ betterleaks: BETTERLEAKS_VERSION, modules }, null, 2)}\n`
  );
  console.log(`wrote ${auditPath} (${modules.length} modules)`);
};

const fetchAll = async (platforms: ReadonlyArray<string>) => {
  const assets =
    platforms.length === 0
      ? Object.keys(BETTERLEAKS_ASSETS)
      : platforms.map((platform) => {
          const asset = betterleaksAsset(platform);

          if (asset === null) throw new Error(`no Betterleaks build for ${platform}`);

          return asset;
        });

  for (const asset of new Set(assets)) {
    const resolved = betterleaksAsset(asset);

    if (resolved === null) continue;
    await fetchBetterleaks(resolved);
    console.log(cachedBetterleaks(resolved));
  }
};

const [command, ...rest] = process.argv.slice(2);

if (command === "audit") await audit();
else if (command === "fetch") await fetchAll(rest);
else {
  console.error("usage: bun scripts/betterleaks.ts <fetch [platform…]|audit>");
  process.exit(2);
}
