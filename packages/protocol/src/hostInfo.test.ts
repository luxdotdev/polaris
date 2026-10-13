import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { HostInfo, Platform } from "./domain.ts";
import { HostId, Timestamp } from "./ids.ts";

const base = {
  hostId: "host-1",
  hostname: "pi",
  platform: "linux-arm64",
  daemonVersion: "0.1.0",
  homeDir: "/home/pi",
  startedAt: "2026-10-13T00:00:00Z",
};

/** `HostInfo` as Clients before `libc` declared it. */
const OlderHostInfo = Schema.Struct({
  hostId: HostId,
  hostname: Schema.String,
  platform: Platform,
  daemonVersion: Schema.String,
  homeDir: Schema.String,
  startedAt: Timestamp,
});

describe("HostInfo.libc on the wire", () => {
  test("a new Client decodes an older Daemon's HostInfo, which has no libc", () => {
    const info = Schema.decodeUnknownSync(HostInfo)(base);

    expect(info.libc).toBeUndefined();
  });

  test("a new Client reads the libc a new Daemon sends", () => {
    const info = Schema.decodeUnknownSync(HostInfo)({ ...base, libc: "musl" });

    expect(info.libc).toBe("musl");
    expect(Schema.encodeSync(HostInfo)(info)).toMatchObject({ libc: "musl" });
  });

  test("an older Client decodes a new Daemon's HostInfo and ignores libc", () => {
    const encoded = Schema.encodeSync(HostInfo)(
      Schema.decodeUnknownSync(HostInfo)({ ...base, libc: "glibc" })
    );

    expect(Schema.decodeUnknownSync(OlderHostInfo)(encoded).platform).toBe("linux-arm64");
  });

  test("an unknown libc is refused", () => {
    expect(() => Schema.decodeUnknownSync(HostInfo)({ ...base, libc: "bionic" })).toThrow();
  });
});
