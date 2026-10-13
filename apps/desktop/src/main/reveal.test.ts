import { describe, expect, test } from "bun:test";
import { HostTarget } from "@polaris/client";
import { revealPath } from "./reveal.ts";

describe("revealPath", () => {
  test("a WSL Host's file shows through \\\\wsl.localhost; the local Host's as is", () => {
    expect(
      revealPath(
        { key: "Ubuntu", target: HostTarget.Wsl({ distro: "Ubuntu" }) },
        "/home/ada/code/polaris"
      )
    ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\ada\\code\\polaris");
    expect(
      revealPath({ key: "local", target: HostTarget.Local({ socketPath: "/s" }) }, "/Users/ada/x")
    ).toBe("/Users/ada/x");
  });

  test("ssh Hosts, socket Hosts and unknown keys have nothing to show here", () => {
    expect(revealPath({ key: "pi", target: HostTarget.Ssh({ alias: "pi" }) }, "/home/pi")).toBe(
      null
    );
    expect(
      revealPath({ key: "bench", target: HostTarget.Local({ socketPath: "/s" }) }, "/x")
    ).toBeNull();
    expect(revealPath(undefined, "/x")).toBeNull();
  });
});
