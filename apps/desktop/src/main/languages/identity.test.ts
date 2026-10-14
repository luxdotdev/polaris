import { expect, test } from "bun:test";
import { LanguageAccess } from "@polaris/client";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { createLanguageBridge, LanguagePreferences, type LanguageHost } from "./index.ts";
import type { IpcError } from "../../shared/api.ts";
import { LanguageRequestInputs } from "../../shared/languages.ts";

const hostId = P.HostId.make("host-a");

/** Why a bridge request was refused, or null when it succeeded. */
const refusal = (result: { ok: true } | { ok: false; error: IpcError }) =>
  result.ok ? null : (result.error.languageError?.reason ?? result.error.code);

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

  for (const [access, epoch, reason] of [
    [null, 1, "not-connected"],
    [accessOf(controller.signal), undefined, "not-connected"],
    [accessOf(controller.signal, []), 1, "unsupported-capability"],
    [accessOf(controller.signal), 0, "invalid-input"],
  ] satisfies ReadonlyArray<readonly [LanguageAccess | null, number | undefined, string]>) {
    const { bridge } = fixture(access, epoch);

    try {
      expect(refusal(await bridge.request("languages.identity.get", { hostKey: "local" }))).toBe(
        reason
      );
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

    expect(refusal(await pending)).toBe("not-connected");
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

    expect(refusal(await pending)).toBe("not-connected");
  } finally {
    bridge.dispose();
  }
});
