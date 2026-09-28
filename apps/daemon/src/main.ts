#!/usr/bin/env bun
/**
 * `polaris` — the Daemon binary. One per user per Host.
 *
 *   polaris serve [--foreground]   run the Daemon (normally started by launchd / systemd --user)
 *   polaris bridge                 pipe stdio to the local Daemon socket; what `ssh <host> polaris bridge` runs
 *   polaris install                install the user service for this binary
 *   polaris version                print the version and platform
 */
const VERSION = "0.0.0"

const [command] = process.argv.slice(2)

switch (command) {
  case "version":
    console.log(`polaris ${VERSION} ${process.platform}-${process.arch}`)
    break
  default:
    console.error(`usage: polaris <serve|bridge|install|version>`)
    process.exit(command === undefined ? 0 : 2)
}
