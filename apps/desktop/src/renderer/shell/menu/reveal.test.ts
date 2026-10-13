import { afterEach, describe, expect, test } from "bun:test";
import { noteHostKinds } from "../../store/hostKinds.ts";
import { revealInFinderEntry } from "./index.ts";

afterEach(() => noteHostKinds([]));

describe("revealInFinderEntry", () => {
  test("the local Host and a WSL distro reveal; ssh and socket Hosts don't", () => {
    noteHostKinds([
      { key: "local", kind: "local" },
      { key: "Ubuntu", kind: "wsl" },
      { key: "studio", kind: "ssh" },
      { key: "bench", kind: "socket" },
    ]);

    expect(revealInFinderEntry("local", "/Users/ada/x")).not.toBeNull();
    expect(revealInFinderEntry("Ubuntu", "/home/ada/x")).not.toBeNull();
    expect(revealInFinderEntry("studio", "/home/ada/x")).toBeNull();
    expect(revealInFinderEntry("bench", "/tmp/x")).toBeNull();
  });

  test("before the first Host list, only the local key reveals", () => {
    expect(revealInFinderEntry("local", "/x")).not.toBeNull();
    expect(revealInFinderEntry("Ubuntu", "/x")).toBeNull();
  });
});
