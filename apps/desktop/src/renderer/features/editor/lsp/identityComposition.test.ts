import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguageRequestOutputs } from "../../../../shared/languages.ts";
import { bindAppLanguageIdentities } from "./identityComposition.ts";
import { identityLookup } from "./bindings.ts";
import type { LanguageHostView } from "./connections.ts";
import type { AuthenticatedLanguageIdentity } from "./lifecycle.ts";

const tick = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

const fixture = () => {
  const hostId = P.HostId.make("fake");

  let hosts: readonly LanguageHostView[] = [
    {
      key: "fake",
      status: {
        state: "connected",
        capabilities: ["languages"],
        languageConnectionEpoch: 7,
        host: new P.HostInfo({
          hostId,
          hostname: "fixture",
          platform: "linux-x64",
          daemonVersion: "fixture",
          homeDir: "/fake",
          startedAt: "2026-10-02T00:00:00Z",
        }),
      },
    },
  ];

  let changed = () => {};

  const requests: string[] = [];
  const pending: Array<(value: AuthenticatedLanguageIdentity) => void> = [];

  const api: LanguageApi = {
    request: async (method) => {
      requests.push(method);

      const value = await new Promise<AuthenticatedLanguageIdentity>((resolve) => {
        pending.push(resolve);
      });

      return { ok: true, value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(value) };
    },
    subscribe: () => () => {},
  };

  const dispose = bindAppLanguageIdentities({
    hosts: () => hosts,
    api: () => api,
    subscribe: (listener) => {
      changed = listener;

      return () => {
        changed = () => {};
      };
    },
  });

  return {
    requests,
    pending,
    dispose,
    identity: (epoch = 7): AuthenticatedLanguageIdentity => ({
      hostId,
      clientId: "independent-fake-Main",
      connectionEpoch: epoch,
    }),
    epoch: (epoch: number) => {
      hosts = hosts.map((host) => ({
        ...host,
        status: { ...host.status, languageConnectionEpoch: epoch },
      }));
      changed();
    },
    unrelated: () => {
      hosts = hosts.map((host) => ({ ...host, status: { ...host.status } }));
      changed();
    },
    remove: () => {
      hosts = [];
      changed();
    },
  };
};

test("projected Main identity composition only fetches typed identity IPC and retains unrelated-update lifetime", async () => {
  const f = fixture();

  try {
    expect(identityLookup("fake")).toBeNull();
    await tick();
    f.pending[0]?.(f.identity());
    await tick();
    expect(identityLookup("fake")).toEqual(f.identity());
    f.unrelated();
    await tick();
    expect(f.requests).toEqual(["languages.identity.get"]);
    f.remove();
    expect(identityLookup("fake")).toBeNull();
  } finally {
    f.dispose();
  }
});

test("late Main result and mismatched expected projected epoch never bind a synchronous identity", async () => {
  const f = fixture();

  try {
    await tick();
    f.epoch(8);
    await tick();
    f.pending[0]?.(f.identity(7));
    f.pending[1]?.(f.identity(7));
    await tick();
    expect(identityLookup("fake")).toBeNull();
    f.epoch(9);
    await tick();
    f.pending[2]?.(f.identity(9));
    await tick();
    expect(identityLookup("fake")?.connectionEpoch).toBe(9);
  } finally {
    f.dispose();
  }
});
