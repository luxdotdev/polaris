/** The real CLI entry point, with service managers replaced at the process boundary. */
import { afterEach, beforeEach, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimePlatform } from "../service/platform.ts";
import { posixTest } from "../platform/testing.ts";
import { commandTarget, inspectCommand, userCommandPath } from "./command.ts";

const posix = posixTest("POSIX CLI service install with fake service managers");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "command-cli-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const executable = (path: string, body: string) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

posix("polaris install exposes the command idempotently and polaris uninstall removes it", () => {
  const tools = join(home, "tools");
  mkdirSync(tools);
  executable(
    join(tools, "launchctl"),
    '#!/bin/sh\nif [ "$1" = print ]; then exit 113; fi\nexit 0\n'
  );
  executable(join(tools, "systemctl"), "#!/bin/sh\nexit 0\n");
  executable(join(tools, "loginctl"), "#!/bin/sh\necho Linger=yes\n");

  const source = join(home, "uploaded-polaris");
  executable(source, `#!/bin/sh\necho polaris 1.0.0 ${runtimePlatform()}\n`);

  const cli = (...args: Array<string>) =>
    spawnSync(process.execPath, [join(import.meta.dir, "../main.ts"), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        POLARIS_HOME: join(home, ".polaris"),
        POLARIS_INSTALL_COMMAND: "1",
        PATH: `${tools}:/usr/bin:/bin`,
      },
    });

  const first = cli("install", "--binary", source, "--json");
  expect(first.status).toBe(0);
  expect(first.stdout).toContain('"ok":true');
  const path = userCommandPath(home);
  const inode = lstatSync(path).ino;
  expect(readlinkSync(path)).toBe(commandTarget(join(home, ".polaris")));
  expect(cli("install", "--binary", source, "--json").status).toBe(0);
  expect(lstatSync(path).ino).toBe(inode);
  expect(first.stdout).toContain("PATH");
  expect(cli("uninstall", "--json").status).toBe(0);
  expect(inspectCommand(path, commandTarget(join(home, ".polaris")), "").state).toBe("absent");
});
