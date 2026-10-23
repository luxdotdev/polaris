/** The phone shows the connection log newest first, and only the latest lines. */
import { expect, test } from "bun:test";
import { captureConsole, connectionLog } from "./log.ts";

test("the newest line comes first, and the oldest fall off past the limit", () => {
  const log = connectionLog(3, () => new Date(2026, 9, 23, 18, 34, 23, 7));

  for (const line of ["opening", "opened", "message 1", "message 2"]) log.add(line);

  expect(log.lines()).toEqual([
    "18:34:23.007 message 2",
    "18:34:23.007 message 1",
    "18:34:23.007 opened",
  ]);
});

test("diagnostics redact credentials, strip control characters and cap each line", () => {
  const log = connectionLog();
  log.add(
    "polaris-pair:v1:eyJ0b2tlbiI6InNlY3JldCJ9 pol_ext_secret\n\u001b[31m\u202e" + "x".repeat(3000)
  );
  const line = log.lines()[0] ?? "";
  expect(line).toContain("[pairing redacted] [token redacted]");
  expect(line).not.toContain("secret");
  expect(line).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  expect(line.length).toBeLessThanOrEqual(1013);
});

test("console capture redacts before forwarding to the WebView console", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const original = { error: console.error, warn: console.warn, log: console.log };
  const forwarded: Array<string> = [];
  const log = connectionLog();

  try {
    Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });

    for (const level of ["error", "warn", "log"] as const)
      console[level] = (...args) => {
        forwarded.push(args.join(" "));
      };

    captureConsole(log);
    console.error(new Error("pol_ext_private_test_token"));
    expect(forwarded).toEqual(["Error: [token redacted]"]);
    expect(log.lines()[0]).toContain("console.error: Error: [token redacted]");

    const event = Object.assign(new Event("unhandledrejection", { cancelable: true }), {
      reason: new Error("pol_ext_unhandled_private_token"),
    });

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(log.lines()[0]).toContain("unhandled rejection: Error: [token redacted]");
  } finally {
    Object.assign(console, original);

    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", descriptor);
  }
});
