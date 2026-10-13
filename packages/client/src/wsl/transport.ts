/**
 * The byte transport to a WSL distro's Daemon: `wsl.exe -d <distro> --exec
 * /bin/sh -c 'exec ~/.polaris/bin/current/polaris bridge'` over stdio, the
 * same `spawnTransport` as ssh. Holding this process open is also what keeps
 * the distro running (docs/adr/0036-wsl-hosts.md).
 */
import type { Connector } from "../transport.ts";
import { spawnTransport } from "../transport.ts";
import { classifyWslExit, wslBridgeArgv, type WslOptions } from "./command.ts";
import { wslEnv, wslStderrDecoder } from "./output.ts";

export interface WslConnectorOptions extends WslOptions {
  readonly env?: Record<string, string | undefined>;
}

export const wslConnector = (distro: string, options: WslConnectorOptions = {}): Connector =>
  spawnTransport(wslBridgeArgv(distro, options), {
    env: wslEnv(options.env),
    stderrDecoder: wslStderrDecoder,
    classify: classifyWslExit,
    spawnFailureReason: "wsl-missing",
  });
