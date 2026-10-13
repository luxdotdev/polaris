/**
 * Where this Client's file manager finds a Host's path: the local Host's own path, or a WSL
 * distro's through `\\wsl.localhost\<distro>\…`. Other Hosts' files aren't on this machine.
 */
import { wslWindowsPath } from "@polaris/client/wsl";
import { HostTarget } from "@polaris/client";
import { type HostEntry, LOCAL_HOST_KEY } from "./hosts.ts";

/** The path to show in Finder or Explorer; null when the Host's files aren't reachable here. */
export const revealPath = (
  entry: Pick<HostEntry, "key" | "target"> | undefined,
  path: string
): string | null =>
  entry === undefined
    ? null
    : HostTarget.$match(entry.target, {
        Local: (): string | null => (entry.key === LOCAL_HOST_KEY ? path : null),
        Ssh: (): string | null => null,
        Wsl: ({ distro }): string | null => wslWindowsPath(distro, path),
      });
