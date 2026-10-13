import { describe, expect, test } from "bun:test";
import { hostEntries, hostKind } from "./hosts.ts";

describe("hostKind", () => {
  test("only the local Host is local; an extra socket Host has no alias but is not it", () => {
    const entries = hostEntries({
      local: {
        socketPath: "/tmp/local.sock",
        installedHome: null,
        benchHarness: false,
        stop: () => Promise.resolve(),
      },
      remotes: [{ alias: "studio" }, { alias: "Ubuntu", kind: "wsl" }],
      extras: [{ key: "bench", label: "Bench", socket: "/tmp/bench.sock" }],
    });

    expect(entries.map((e) => [e.key, e.alias, hostKind(e)])).toEqual([
      ["local", null, "local"],
      ["bench", null, "socket"],
      ["studio", "studio", "ssh"],
      ["Ubuntu", "Ubuntu", "wsl"],
    ]);
  });
});
