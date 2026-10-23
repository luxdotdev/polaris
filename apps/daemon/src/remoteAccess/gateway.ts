/**
 * Where the gateway listens (ENG-399's contract): `127.0.0.1`, the port in
 * `~/.polaris/gateway.json` (`{ "port": … }`, 7477 without one), path `/polaris/rpc`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";

export const DEFAULT_GATEWAY_PORT = 7477;

/** The path prefix Remote Access serves; the gateway's RPC endpoint is under it. */
export const GATEWAY_PREFIX = "/polaris";

export const GATEWAY_RPC_PATH = `${GATEWAY_PREFIX}/rpc`;

const GatewayFile = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
});

const decodeGatewayFile = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayFile));

/** The gateway's port as `root/gateway.json` says, else the default. */
export const gatewayPort = (root: string): number => {
  let text: string;

  try {
    text = readFileSync(join(root, "gateway.json"), "utf8");
  } catch {
    return DEFAULT_GATEWAY_PORT;
  }

  return Option.match(decodeGatewayFile(text), {
    onNone: () => DEFAULT_GATEWAY_PORT,
    onSome: (file) => file.port,
  });
};

/** What `tailscale serve` proxies to: the prefix it strips, put back. */
export const serveTarget = (port: number): string => `http://127.0.0.1:${port}${GATEWAY_PREFIX}`;
