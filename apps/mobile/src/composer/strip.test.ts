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
  ])("%s opens to every line instead of sitting beside Approve", (_, detail) => {
    const strip = stripOf({
      requests: [request({ kind: "command", detail })],
      working: false,
      harness: "Claude Code",
    });

    expect(strip?.notice).toMatchObject({ kind: "approval", compact: false });
  });
});
