/**
 * app.json for one build: the network whitelist lists every origin the app
 * may reach. A bare host gets both `https://` and `wss://`.
 */

export interface Manifest {
  readonly version: string;
  readonly permissions: ReadonlyArray<{
    readonly name: string;
    readonly whitelist?: ReadonlyArray<string>;
  }>;
}

const SCHEMES = new Set(["https:", "wss:", "http:", "ws:"]);

export class BadHost extends Error {}

/** `mac.tailnet.ts.net`, `wss://mac.tailnet.ts.net` or `ws://127.0.0.1:7477` → origins. */
export const originsOf = (host: string): ReadonlyArray<string> => {
  const withScheme = host.includes("://") ? host : `https://${host}`;
  let url: URL;

  try {
    url = new URL(withScheme);
  } catch {
    throw new BadHost(`not a host or origin: ${host}`);
  }

  if (!SCHEMES.has(url.protocol) || url.username !== "" || url.password !== "")
    throw new BadHost(`not a host or origin: ${host}`);

  return host.includes("://") ? [url.origin] : [url.origin, `wss://${url.host}`];
};

export const withWhitelist = <M extends Manifest>(
  manifest: M,
  hosts: ReadonlyArray<string>,
  version: string
): Omit<M, keyof Manifest> & Manifest => {
  const whitelist = [...new Set(hosts.flatMap(originsOf))];

  return {
    ...manifest,
    version,
    permissions: manifest.permissions.map((permission) =>
      permission.name === "network" ? { ...permission, whitelist } : permission
    ),
  };
};

export const hostsFromArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.flatMap((arg, index) => {
    if (arg.startsWith("--host=")) return [arg.slice("--host=".length)];

    return arg === "--host" && args[index + 1] !== undefined ? [args[index + 1] ?? ""] : [];
  });
