import { describe, expect, test } from "bun:test";
import { deepLinkArg, parseDeepLink } from "./deepLink.ts";

describe("parseDeepLink", () => {
  test.each([
    ["polaris://session/h1/s1", { target: "session", hostId: "h1", sessionId: "s1" }],
    ["polaris://workspace/h1/w1", { target: "workspace", hostId: "h1", workspaceId: "w1" }],
    ["polaris://session/h1/s1/", { target: "session", hostId: "h1", sessionId: "s1" }],
    ["POLARIS://Session/h1/s1", { target: "session", hostId: "h1", sessionId: "s1" }],
    [
      "polaris://workspace/host%20a/w%3A1",
      { target: "workspace", hostId: "host a", workspaceId: "w:1" },
    ],
  ])("%s navigates", (url, link) => {
    expect<unknown>(parseDeepLink(url)).toEqual({ link });
  });

  test.each([
    ["https://session/h1/s1", "not a polaris:// link"],
    ["not a url", "not a polaris:// link"],
    ["polaris://session/h1/s1?approve=1", "unexpected query or fragment"],
    ["polaris://session/h1/s1#x", "unexpected query or fragment"],
    ["polaris://session/h1/s1?", "unexpected query or fragment"],
    ["polaris://session/h1/s1#", "unexpected query or fragment"],
    ["polaris://session/h\t1/s1", "control character"],
    ["polaris://session/h1/a\nb", "control character"],
    ["polaris://session/junk/../h1/s1", "not a session or workspace link"],
    ["polaris://session/junk/%2e%2e/h1/s1", "not a session or workspace link"],
    ["polaris://user@session/h1/s1", "unexpected authority"],
    ["polaris://session/h1/%E0%A4%A", "malformed percent-encoding"],
    ["polaris://session/h1", "not a session or workspace link"],
    ["polaris://session/h1/s1/extra", "not a session or workspace link"],
    ["polaris://session//s1", "not a session or workspace link"],
    ["polaris://session/h1/a%2Fb", "not a session or workspace link"],
    ["polaris://session/h1/a%00b", "not a session or workspace link"],
    ["polaris://approve/h1/r1", "not a session or workspace link"],
    [`polaris://session/h1/${"s".repeat(300)}`, "not a session or workspace link"],
    [`polaris://session/h1/${"s".repeat(3000)}`, "too long"],
  ])("%s is ignored", (url, reason) => {
    expect<unknown>(parseDeepLink(url)).toEqual({ ignored: reason });
  });
});

describe("deepLinkArg", () => {
  test("finds the link among Chromium's switches", () => {
    expect(
      deepLinkArg(["Polaris.exe", "--allow-file-access", "polaris://session/h/s", "--x"])
    ).toBe("polaris://session/h/s");
    expect(deepLinkArg(["Polaris.exe", "--allow-file-access"])).toBeNull();
  });
});
