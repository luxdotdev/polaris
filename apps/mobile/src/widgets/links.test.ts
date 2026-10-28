import { describe, expect, test } from "bun:test";
import { HOME_LINK, routeOfLink, sessionLink } from "./links.ts";

describe("widget links", () => {
  test("home opens the tabs", () => {
    expect(routeOfLink(HOME_LINK)).toEqual({ screen: "tabs" });
  });

  test("an agent session's link opens its thread, ids with slashes and spaces intact", () => {
    const link = sessionLink("mac/studio 1", "s#1?x");

    expect(routeOfLink(link)).toEqual({
      screen: "thread",
      hostId: "mac/studio 1",
      sessionId: "s#1?x",
    });
  });

  test.each([
    "https://polaris.dev/session/a/b",
    "polaris://session/a",
    "polaris://session/a/b/c",
    "polaris://session//b",
    "polaris://session/%E0%A4%A/b",
    "polaris://settings",
  ])("%s opens nothing", (url) => {
    expect(routeOfLink(url)).toBeNull();
  });
});
