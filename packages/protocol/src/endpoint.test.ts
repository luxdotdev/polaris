import { describe, expect, test } from "bun:test";
import { isPipePath, localEndpoint, PIPE_PREFIX, windowsPipeName } from "./endpoint.ts";

describe("localEndpoint", () => {
  test("a Unix Host listens on daemon.sock in the Polaris home", () => {
    expect(localEndpoint("/home/pi/.polaris", "linux")).toBe("/home/pi/.polaris/daemon.sock");
    expect(localEndpoint("/Users/l/.polaris", "darwin")).toBe("/Users/l/.polaris/daemon.sock");
  });

  test("a Windows Host listens on a pipe named for its home", () => {
    const pipe = localEndpoint("C:\\Users\\lucas\\.polaris", "win32");

    expect(pipe).toStartWith(PIPE_PREFIX);
    expect(isPipePath(pipe)).toBe(true);
    expect(pipe).toBe(windowsPipeName("C:\\Users\\lucas\\.polaris"));
  });
});

describe("windowsPipeName", () => {
  test("the same directory gives the same pipe, whatever its case or trailing separator", () => {
    const pipe = windowsPipeName("C:\\Users\\lucas\\.polaris");

    expect(windowsPipeName("c:\\users\\LUCAS\\.polaris\\")).toBe(pipe);
    expect(windowsPipeName("C:/Users/lucas/.polaris/")).toBe(pipe);
  });

  test("another user or another POLARIS_HOME gets another pipe", () => {
    const pipe = windowsPipeName("C:\\Users\\lucas\\.polaris");

    expect(windowsPipeName("C:\\Users\\guest\\.polaris")).not.toBe(pipe);
    expect(windowsPipeName("C:\\Users\\lucas\\polaris-test")).not.toBe(pipe);
  });

  test("the name never reveals the home it was made from", () => {
    expect(windowsPipeName("C:\\Users\\lucas\\.polaris").toLowerCase()).not.toContain("lucas");
  });
});

describe("isPipePath", () => {
  test.each([
    ["\\\\.\\pipe\\polaris-abc", true],
    ["//./pipe/polaris-abc", true],
    ["\\\\?\\pipe\\polaris-abc", true],
    ["\\\\server\\pipe\\polaris-abc", false],
    ["/home/pi/.polaris/daemon.sock", false],
    ["C:\\Users\\lucas\\.polaris\\daemon.sock", false],
  ])("%s is a local pipe: %p", (path, expected) => {
    expect(isPipePath(path)).toBe(expected);
  });
});
