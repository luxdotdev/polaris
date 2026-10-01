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
 *   polaris rules-scan             (internal) run the Rules' pattern scan; the Daemon starts it
 */
// Every command loads only what it needs: `bridge` runs once per remote Client for as
// long as it stays connected, and `serve` should not carry the install code.

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "serve": {
    const { runServe } = await import("./transport/serve.ts");
    runServe();
    break;
  }

  case "bridge": {
    const { runBridge } = await import("./transport/bridge.ts");
    process.exit(await runBridge());
    break;
  }

  case "version": {
    const { versionLine } = await import("./service/platform.ts");
    console.log(versionLine());
    break;
  }

  case "selftest": {
    const { selfTest } = await import("./service/selftest.ts");
    const result = await selfTest();
    console.log(result.lines.join("\n"));
    process.exitCode = result.ok ? 0 : 1;
    break;
  }

  case "rules-scan": {
    const { runRulesScan } = await import("./rules/patterns/child.ts");
    process.exit(await runRulesScan());
    break;
  }

  default: {
    const { isServiceCommand, runServiceCommand } = await import("./service/cli.ts");

    if (isServiceCommand(command)) {
      process.exit(await runServiceCommand(command, args));
    }

    console.error(`usage: polaris <serve|bridge|install|uninstall|upgrade|version|selftest>`);
    process.exit(command === undefined ? 0 : 2);
  }
}

export {};
