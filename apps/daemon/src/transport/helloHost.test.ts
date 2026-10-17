import { describe, expect, test } from "bun:test";
import { HostInfo, PROTOCOL_VERSION } from "@polaris/protocol";
import { Schema } from "effect";
import { helloHost } from "./hostInfo.ts";

const host = (platform: string) =>
  Schema.decodeUnknownSync(HostInfo)({
    hostId: "host-1",
    hostname: "desktop",
    platform,
    daemonVersion: "0.2.0",
    homeDir: "C:\\Users\\lucas",
    startedAt: "2026-10-16T00:00:00Z",
  });

describe("helloHost", () => {
  test("a Client that decodes any platform is told the Host is windows-x64", () => {
    const answer = helloHost(host("windows-x64"), ["host.any-platform"]);

    expect(answer).toEqual({ host: host("windows-x64"), protocolVersion: PROTOCOL_VERSION });
  });

  test("an older Client gets a newer protocol version, so it asks for an update", () => {
    const answer = helloHost(host("windows-x64"), []);

    expect(answer.protocolVersion).toBeGreaterThan(PROTOCOL_VERSION);
    expect(answer.host.platform).not.toBe("windows-x64");
    expect(answer.host.hostId).toBe(host("windows-x64").hostId);
  });

  test("an older Client of a Unix Host is answered as before", () => {
    expect(helloHost(host("linux-arm64"), [])).toEqual({
      host: host("linux-arm64"),
      protocolVersion: PROTOCOL_VERSION,
    });
  });
});
