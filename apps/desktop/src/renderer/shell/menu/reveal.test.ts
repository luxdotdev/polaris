import { afterEach, describe, expect, test } from "bun:test";
import type { PolarisApi } from "../../../shared/api.ts";
import { standInBridge } from "../../features/bridge.ts";
import { noteHostKinds } from "../../store/hostKinds.ts";
import { revealInFinderEntry } from "./index.ts";

afterEach(() => {
  noteHostKinds([]);
  standInBridge(null);
});

/** Picks the entry and returns the requests it sent, or null when there is no entry. */
const reveal = (hostKey: string, path: string) => {
  const sent: Array<[string, unknown]> = [];

  standInBridge({
    request: (method, input) => {
      sent.push([method, input]);

      // SAFETY: the reveal entry ignores the response.
      return Promise.resolve({ ok: true, value: null }) as never;
    },
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  } satisfies PolarisApi);

  const entry = revealInFinderEntry(hostKey, path);

  if (entry === null) return null;

  if (entry.kind === "item") entry.onSelect();

  return sent;
};

describe("revealInFinderEntry", () => {
  test("the local Host and a WSL distro reveal; ssh and socket Hosts don't", () => {
    noteHostKinds([
      { key: "local", kind: "local" },
      { key: "Ubuntu", kind: "wsl" },
      { key: "studio", kind: "ssh" },
      { key: "bench", kind: "socket" },
    ]);

    expect(reveal("local", "/Users/ada/x")).toEqual([
      ["shell.revealInFinder", { hostKey: "local", path: "/Users/ada/x" }],
    ]);
    expect(reveal("Ubuntu", "/home/ada/x")).toEqual([
      ["shell.revealInFinder", { hostKey: "Ubuntu", path: "/home/ada/x" }],
    ]);
    expect(reveal("studio", "/home/ada/x")).toBeNull();
    expect(reveal("bench", "/tmp/x")).toBeNull();
  });

  test("before the first Host list, only the local key reveals", () => {
    expect(reveal("local", "/x")).toEqual([
      ["shell.revealInFinder", { hostKey: "local", path: "/x" }],
    ]);
    expect(reveal("Ubuntu", "/x")).toBeNull();
  });
});
