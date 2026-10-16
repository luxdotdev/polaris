/**
 * A fake `wsl.exe` for tests on macOS and Linux: `--list --verbose` prints
 * the configured distros as UTF-16LE (or UTF-8 under `WSL_UTF8=1`, like WSL ≥
 * 0.64), and `--distribution <name> --exec <argv…>` runs `argv` locally with
 * HOME at that distro's directory. Not shipped. See docs/adr/0036-wsl-hosts.md.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FakeDistro {
  readonly name: string;
  readonly version: 1 | 2;
  readonly state: "Running" | "Stopped";
  readonly isDefault?: boolean;
  /** The directory that is `$HOME` inside this "distro"; created if missing. */
  readonly home: string;
}

export interface FakeWslConfig {
  readonly distros: ReadonlyArray<FakeDistro>;
  /** False plays the Windows stub that says WSL isn't installed. */
  readonly installed?: boolean;
  /** False plays a WSL older than 0.64, which ignores `WSL_UTF8` and always writes UTF-16LE. */
  readonly honoursUtf8?: boolean;
}

/** The script's source; it reads its config from `POLARIS_FAKE_WSL_CONFIG`. */
export const fakeWslSource = (): string => `#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const config = JSON.parse(readFileSync(process.env.POLARIS_FAKE_WSL_CONFIG, "utf8"));
const utf8 = (config.honoursUtf8 ?? true) && process.env.WSL_UTF8 === "1";

const say = (fd, text) => {
  const bytes = utf8 ? Buffer.from(text, "utf8") : Buffer.from(text, "utf16le");
  if (fd === 1) process.stdout.write(bytes); else process.stderr.write(bytes);
};

const args = process.argv.slice(2);
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));

if (config.installed === false) {
  say(2, "Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'.\\r\\n");
  process.exit(1);
}

if (args[0] === "--list" || args[0] === "-l") {
  if (config.distros.length === 0) {
    say(1, "Windows Subsystem for Linux has no installed distributions.\\r\\n");
    process.exit(1);
  }
  const lines = ["  " + pad("NAME", 24) + pad("STATE", 16) + "VERSION"];
  for (const d of config.distros) {
    lines.push((d.isDefault ? "* " : "  ") + pad(d.name, 24) + pad(d.state, 16) + String(d.version));
  }
  say(1, lines.join("\\r\\n") + "\\r\\n");
  process.exit(0);
}

let distro = null;
let rest = args;
if (args[0] === "--distribution" || args[0] === "-d") {
  distro = args[1];
  rest = args.slice(2);
}
const found = config.distros.find((d) => d.name === distro);
if (found === undefined) {
  // Real wsl.exe (2.7) writes its own errors to stdout and exits -1 (255, or 4294967295 under Node).
  say(1, "There is no distribution with the supplied name.\\r\\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\\r\\n");
  process.exit(255);
}
if (rest[0] !== "--exec" && rest[0] !== "-e") process.exit(0);
const argv = rest.slice(1);
const child = spawnSync(argv[0], argv.slice(1), {
  cwd: found.home,
  env: { PATH: process.env.PATH, HOME: found.home, USER: process.env.USER ?? "user" },
  stdio: "inherit",
});
process.exit(child.status ?? 1);
`;

/** What to pass as `wslBinary` and `env` to reach the fake. */
export interface FakeWsl {
  readonly wslBinary: string;
  readonly env: Record<string, string | undefined>;
}

/** Writes the fake under `dir` and returns how to reach it. */
export const writeFakeWsl = (dir: string, config: FakeWslConfig): FakeWsl => {
  mkdirSync(dir, { recursive: true });

  for (const distro of config.distros) mkdirSync(distro.home, { recursive: true });
  const configPath = join(dir, "fake-wsl.json");
  writeFileSync(configPath, JSON.stringify(config));
  const wslBinary = join(dir, "wsl.exe");
  writeFileSync(wslBinary, fakeWslSource());
  chmodSync(wslBinary, 0o755);

  return { wslBinary, env: { ...process.env, POLARIS_FAKE_WSL_CONFIG: configPath } };
};
