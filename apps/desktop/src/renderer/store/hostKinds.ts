/**
 * Each Host's kind by key, as the last Host list said, for helpers that build menus from a
 * Host key alone (Reveal in Finder). The store updates it with every list.
 */
import type { HostKind, HostView } from "../../shared/api.ts";

let kinds: ReadonlyMap<string, HostKind> = new Map();

export const noteHostKinds = (hosts: ReadonlyArray<Pick<HostView, "key" | "kind">>) => {
  kinds = new Map(hosts.map((host) => [host.key, host.kind]));
};

export const hostKindOf = (hostKey: string): HostKind | undefined => kinds.get(hostKey);
