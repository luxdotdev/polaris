#!/usr/bin/env bun
/**
 * `polaris` — the Daemon binary. One per user per Host.
 *
 *   polaris serve [--foreground]   run the Daemon (normally started by launchd / systemd --user)
 *   polaris bridge                 pipe stdio to the local Daemon socket; what `ssh <host> polaris bridge` runs
 *   polaris install                install this binary and the user service
 *   polaris uninstall [--purge]    remove the user service and binaries (state kept unless --purge)
 *   polaris upgrade <path>         install <path> and hand the running Daemon over to it in place
 *   polaris version                print the version and platform
 *   polaris selftest               check this build's native libraries work here (exit 1 if not)
 */
import { isServiceCommand, runServiceCommand, versionLine } from "./service/cli.ts"

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case "version":
    console.log(versionLine())
    break
  case "selftest": {
    const { selfTest } = await import("./service/selftest.ts")
    const result = await selfTest()
    console.log(result.lines.join("\n"))
    process.exitCode = result.ok ? 0 : 1
    break
  }
  default:
    if (isServiceCommand(command)) {
      process.exit(await runServiceCommand(command, args))
    }
    console.error(`usage: polaris <serve|bridge|install|uninstall|upgrade|version|selftest>`)
    process.exit(command === undefined ? 0 : 2)
}
