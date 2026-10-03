import { expect, test } from "bun:test";
import { LanguageAccess } from "@polaris/client";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { createLanguageBridge, LanguagePreferences, type LanguageHost } from "./index.ts";
import { LanguageRequestInputs } from "../../shared/languages.ts";

const hostId = P.HostId.make("host-a");

const accessOf = (signal: AbortSignal, capabilities: ReadonlyArray<P.Capability> = ["languages"]) =>
  new LanguageAccess({
    hostId,
    clientId: "main-bound-client",
    capabilities,
    signal,
    invoke: async () => {
      throw new Error("identity lookup must not invoke a Daemon request");
    },
    watch: async function* () {},
    takeBlob: async () => new Uint8Array(),
  });

const fixture = (access: LanguageAccess | null, connectionEpoch?: number) => {
  const base = {
    hostId,
    access,
    authorizeWorkspace: () => false,
    authorizeCheckout: () => false,
  };

  const initial: LanguageHost = connectionEpoch === undefined ? base : { ...base, connectionEpoch };

  let current: LanguageHost | null = initial;

  const bridge = createLanguageBridge({
    preferences: new LanguagePreferences(
      () => ({ theme: "dark" }),
      () => {}
    ),
    lookup: () => current,
  });

  return {
    bridge,
    replace: () => {
      current = null;
    },
  };
};

test("identity lookup returns only Main-bound identity and epoch", async () => {
  const controller = new AbortController();
  const { bridge } = fixture(accessOf(controller.signal), 7);

  try {
    const input = Schema.decodeUnknownSync(LanguageRequestInputs["languages.identity.get"])({
      hostKey: "local",
      clientId: "renderer-invented-client",
      connectionEpoch: 99,
    });

    const value = await bridge.request("languages.identity.get", input);

    expect(value).toEqual({
      ok: true,
      value: { hostId, clientId: "main-bound-client", connectionEpoch: 7 },
    });
  } finally {
    bridge.dispose();
  }
});

test("absent transport, epoch or capability cannot produce an identity", async () => {
  const controller = new AbortController();

  for (const [access, epoch] of [
    [null, 1],
    [accessOf(controller.signal), undefined],
    [accessOf(controller.signal, []), 1],
    [accessOf(controller.signal), 0],
  ] satisfies ReadonlyArray<readonly [LanguageAccess | null, number | undefined]>) {
    const { bridge } = fixture(access, epoch);

    try {
      expect((await bridge.request("languages.identity.get", { hostKey: "local" })).ok).toBe(false);
    } finally {
      bridge.dispose();
    }
  }
});

test("disconnect during async IPC settlement fences the previously read identity", async () => {
  const controller = new AbortController();
  const { bridge } = fixture(accessOf(controller.signal), 2);

  try {
    const pending = bridge.request("languages.identity.get", { hostKey: "local" });
    controller.abort();

    expect((await pending).ok).toBe(false);
  } finally {
    bridge.dispose();
  }
});

test("replacement during async IPC settlement fences the old identity", async () => {
  const controller = new AbortController();
  const { bridge, replace } = fixture(accessOf(controller.signal), 2);

  try {
    const pending = bridge.request("languages.identity.get", { hostKey: "local" });
    replace();

    expect((await pending).ok).toBe(false);
  } finally {
    bridge.dispose();
  }
});
