import { describe, expect, test } from "bun:test";
import { RequestId } from "@polaris/protocol";
import { request } from "../thread/daemon.testing.ts";
import { stripOf } from "./strip.ts";

const at = (minute: number) => `2026-10-29T12:0${minute}:00.000Z`;

describe("the composer's notice strip", () => {
  test("nothing asked and nothing working: no strip", () => {
    expect(stripOf({ requests: [], working: false, harness: "Claude Code" })).toBeNull();
  });

  test("working with nothing asked shows Working", () => {
    expect(stripOf({ requests: [], working: true, harness: "Claude Code" })?.notice.kind).toBe(
      "working"
    );
  });

  test("a request asked while the lead works on takes the strip, not Working", () => {
    const strip = stripOf({
      requests: [request({ kind: "command", detail: "bun run build" })],
      working: true,
      harness: "Claude Code",
    });

    expect(strip?.notice).toMatchObject({
      kind: "approval",
      headline: "Claude Code wants to run",
      detail: "$ bun run build",
      compact: true,
    });
  });

  test("the oldest request leads and the rest count behind it", () => {
    const strip = stripOf({
      requests: [
        request({ id: RequestId.make("late"), openedAt: at(5) }),
        request({ id: RequestId.make("early"), openedAt: at(1) }),
        request({ id: RequestId.make("middle"), openedAt: at(3) }),
      ],
      working: false,
      harness: "Codex",
    });

    expect(strip?.notice.kind === "working" ? null : strip?.notice.request.id).toBe(
      RequestId.make("early")
    );
    expect(strip?.more).toBe(2);
  });

  test.each([
    ["a long command", "x".repeat(80)],
    ["a multi-line command", "cd apps\nbun test"],
    ["a line separator", "ls\u2028rm -rf ~"],
    ["a bidi override", "ls \u202e~ fr- mr"],
    ["a zero-width space", "ls\u200b"],
    ["past what fits beside Approve", "bun run build:all" + "x".repeat(10)],
  ])("%s opens to every line instead of sitting beside Approve", (_, detail) => {
    const strip = stripOf({
      requests: [request({ kind: "command", detail })],
      working: false,
      harness: "Claude Code",
    });

    expect(strip?.notice).toMatchObject({ kind: "approval", compact: false });
  });

  test("a right-to-left override can't disguise a command: each hidden mark is named", () => {
    const strip = stripOf({
      requests: [request({ kind: "command", detail: "cat \u202Egnp.exe" })],
      working: true,
      harness: "Claude Code",
    });

    expect(strip?.notice).toMatchObject({
      detail: "$ cat ⟨U+202E⟩gnp.exe",
      compact: false,
    });
  });
});
