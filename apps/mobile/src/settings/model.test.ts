import { describe, expect, test } from "bun:test";
import { hostsLine } from "./model.ts";

const host = (name: string, state: "connected" | "reconnecting" | "offline" | "needs-attention") =>
  ({ name, state }) as const;

describe("the Hosts row's line", () => {
  test("names two Hosts, counts the rest and flags one reconnecting (MX-G)", () => {
    expect(
      hostsLine([
        host("mac-studio", "connected"),
        host("lucas-rpi", "connected"),
        host("ci-box", "reconnecting"),
        host("vm", "connected"),
      ])
    ).toEqual({ names: "mac-studio, lucas-rpi + 2", note: "1 reconnecting" });
  });

  test("a single healthy Host has no note and no count", () => {
    expect(hostsLine([host("mac-studio", "connected")])).toEqual({
      names: "mac-studio",
      note: null,
    });
  });

  test("needs attention outranks offline", () => {
    expect(
      hostsLine([host("a", "offline"), host("b", "needs-attention"), host("c", "offline")]).note
    ).toBe("1 needs attention");
  });

  test("no Hosts says so", () => {
    expect(hostsLine([]).names).toBe("No hosts yet");
  });
});
