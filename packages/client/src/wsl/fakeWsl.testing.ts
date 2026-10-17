/**
 * A fake `wsl.exe` for tests on macOS and Linux: `--list --verbose` prints
 * the configured distros as UTF-16LE (or UTF-8 under `WSL_UTF8=1`, like WSL ≥
 * 0.64), and `--distribution <name> --exec <argv…>` runs `argv` locally with
 * HOME at that distro's directory. Not shipped. See docs/adr/0036-wsl-hosts.md.
 * Portions adapted from microsoft/WSL@ce886386 (MIT): its en-US and de-DE messages.
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
  /** With `installed: false`: Windows' own wsl.exe without WSL, waiting on "Press any key to install". */
  readonly prompts?: boolean;
  /** False plays a WSL older than 0.64, which ignores `WSL_UTF8` and always writes UTF-16LE. */
  readonly honoursUtf8?: boolean;
  /** The display language of WSL's own messages; English by default. */
  readonly language?: "en" | "de";
}

/** WSL's messages (`localization/strings/<lang>/Resources.resw`), as wsl.exe prints them. */
export const FAKE_WSL_MESSAGES = {
  en: {
    noDistros:
      "Windows Subsystem for Linux has no installed distributions.\r\nYou can resolve this by installing a distribution with the instructions below:\r\n\r\nUse 'wsl.exe --list --online' to list available distributions\r\nand 'wsl.exe --install <Distro>' to install.\r\n",
    notFound:
      "There is no distribution with the supplied name.\r\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n",
  },
  de: {
    noDistros:
      'Windows-Subsystem für Linux verfügt über keine installierten Distributionen.\r\nSie können dies beheben, indem Sie eine Distribution mit den folgenden Anweisungen installieren:\r\n\r\n"wsl.exe --list --online\' zum Auflisten verfügbarer Distributionen verwenden\r\nund "wsl.exe --install <Distro>".\r\n',
    notFound:
      "Es ist keine Distribution mit dem angegebenen Namen vorhanden.\r\nFehlercode: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n",
  },
} as const;

/** The script's source; it reads its config from `POLARIS_FAKE_WSL_CONFIG`. */
export const fakeWslSource = (): string => `#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const config = JSON.parse(readFileSync(process.env.POLARIS_FAKE_WSL_CONFIG, "utf8"));
const utf8 = (config.honoursUtf8 ?? true) && process.env.WSL_UTF8 === "1";
const messages = ${JSON.stringify(FAKE_WSL_MESSAGES)}[config.language ?? "en"];

const say = (fd, text) => {
  const bytes = utf8 ? Buffer.from(text, "utf8") : Buffer.from(text, "utf16le");
  if (fd === 1) process.stdout.write(bytes); else process.stderr.write(bytes);
};

const args = process.argv.slice(2);
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));

const stub = () => {
  if (config.prompts === true) {
    // Windows' own wsl.exe (System32, 26100) without WSL: its resources hold this prompt.
    say(1, "\\r\\nPress any key to install Windows Subsystem for Linux.\\r\\nPress CTRL-C or close this window to cancel.\\r\\nThis prompt will time out in 60 seconds.\\r\\n");
    setTimeout(() => process.exit(1), 60_000);
    return;
  }
  say(2, "Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'.\\r\\n");
  process.exit(1);
};

const list = () => {
  if (args[1] === "--quiet" || args[1] === "-q") {
    // No header and no message, and exit 0 even with no distro (WslClient.cpp).
    say(1, config.distros.map((d) => d.name + "\\r\\n").join(""));
    process.exit(0);
  }
  if (config.distros.length === 0) {
    // Real wsl.exe prints this on stdout without an error code, and exits -1.
    say(1, messages.noDistros);
    process.exit(255);
  }
  const lines = ["  " + pad("NAME", 24) + pad("STATE", 16) + "VERSION"];
  for (const d of config.distros) {
    lines.push((d.isDefault ? "* " : "  ") + pad(d.name, 24) + pad(d.state, 16) + String(d.version));
  }
  say(1, lines.join("\\r\\n") + "\\r\\n");
  process.exit(0);
};

const exec = () => {
  let distro = null;
  let rest = args;
  if (args[0] === "--distribution" || args[0] === "-d") {
    distro = args[1];
    rest = args.slice(2);
  }
  const found = config.distros.find((d) => d.name === distro);
  if (found === undefined) {
    // Real wsl.exe (2.7) writes its own errors to stdout and exits -1 (255, or 4294967295 under Node).
    say(1, messages.notFound);
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
};

if (config.installed === false) stub();
else if (args[0] === "--list" || args[0] === "-l") list();
else exec();
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
