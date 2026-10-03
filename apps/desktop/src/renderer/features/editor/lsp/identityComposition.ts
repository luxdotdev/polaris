import type { LanguageApi } from "../../../../shared/api.ts";
import { RendererLanguageConnections, type LanguageHostView } from "./connections.ts";
import { bindRendererLanguageIdentities } from "./identity.ts";

export interface AppLanguageIdentityPorts {
  readonly hosts: () => readonly LanguageHostView[];
  readonly api: () => LanguageApi | undefined;
  readonly subscribe: (changed: () => void) => () => void;
}

/** Bind once in the lazy Editor runtime; no access exists without Main's epoch and identity API. */
export const bindAppLanguageIdentities = (ports: AppLanguageIdentityPorts) => {
  const connections = new RendererLanguageConnections(ports.hosts);

  const unbind = bindRendererLanguageIdentities({
    connection: connections.connection,
    hostKeys: () => connections.keys(),
    subscribe: (changed) =>
      ports.subscribe(() => {
        connections.refresh();
        changed();
      }),
    fetch: async (hostKey, signal) => {
      const expected = connections.connection(hostKey);
      const api = ports.api();

      if (expected === null || signal.aborted || api === undefined) return null;
      const result = await api.request("languages.identity.get", { hostKey });

      if (signal.aborted || connections.connection(hostKey) !== expected || !result.ok) return null;
      const identity = result.value;

      return identity.hostId === expected.hostId && identity.connectionEpoch === expected.epoch
        ? identity
        : null;
    },
  });

  return () => {
    unbind();
    connections.dispose();
  };
};
