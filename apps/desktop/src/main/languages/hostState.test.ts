import { test, expect } from "bun:test";
import { LanguageAccess } from "@polaris/client";
import { HostId, LanguageHostState } from "@polaris/protocol";
import { createLanguageBridge, LanguagePreferences } from "./index.ts";

test("Desktop bridge routes Host read/feed before any Workspace is registered", async () => {
  const hostId = HostId.make("host-state-main");

  const state = LanguageHostState.make({
    hostId,
    platform: { os: "linux", arch: "arm64", libc: "glibc" },
    tools: [],
  });

  const access = new LanguageAccess({
    hostId,
    clientId: "client",
    capabilities: ["languages"],
    signal: new AbortController().signal,
    invoke: async () => state,
    watch: async function* () {
      yield state;
    },
    takeBlob: async () => new Uint8Array(),
  });

  const host = {
    hostId,
    access,
    authorizeWorkspace: () => {
      throw new Error("Host read must not authorize a Workspace");
    },
    authorizeCheckout: () => {
      throw new Error("Host read must not authorize a checkout");
    },
  };

  const preferences = new LanguagePreferences(
    () => ({ theme: "dark" }),
    () => {}
  );

  const bridge = createLanguageBridge({ preferences, lookup: () => host });

  try {
    const response = await bridge.request("languages.host.state", {
      hostKey: "host",
      toolIds: [],
      refresh: true,
    });

    expect(response).toEqual({ ok: true, value: state });

    const delivered = new Promise<readonly LanguageHostState[]>((resolve, reject) => {
      bridge.subscribe(
        "languages.host.state.watch",
        { hostKey: "host", toolIds: [], refresh: true },
        {
          items: resolve,
          end: (error) => {
            if (error !== null) reject(new Error(error.message));
          },
        }
      );
    });

    expect(await delivered).toEqual([state]);
  } finally {
    bridge.dispose();
    access.dispose();
  }
});
