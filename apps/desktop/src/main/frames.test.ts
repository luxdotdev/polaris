import { describe, expect, mock, test } from "bun:test";
import { FRAME_PREFIX, frameDocuments, frameResponse, subframeMayLoad } from "./frames.ts";

void mock.module("electron", () => ({ net: {}, protocol: {} }));

const { isTrustedUrl } = await import("./protocol.ts");

describe("frame documents", () => {
  test("a document is served once, under the frame CSP", async () => {
    const frames = frameDocuments();
    const url = frames.serve("<p>chart</p>");
    const first = frameResponse(frames, url);

    expect(await first.text()).toBe("<p>chart</p>");
    expect(first.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(first.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts");
    // A reload is a second page: nothing is there.
    expect(frameResponse(frames, url).status).toBe(404);
  });

  test("an unknown token is refused", () => {
    expect(frameResponse(frameDocuments(), `${FRAME_PREFIX}nope`).status).toBe(404);
  });

  test("documents nobody loads are dropped oldest first", () => {
    let n = 0;
    const frames = frameDocuments(() => String(n++));
    const first = frames.serve("first");

    for (let i = 0; i < 16; i++) frames.serve(`doc ${i}`);

    expect(frames.take(first)).toBeNull();
    expect(frames.take(`${FRAME_PREFIX}16`)).toBe("doc 15");
  });
});

describe("frames stay on their page", () => {
  test.each([
    ["https://example.com/?leak=1", false],
    ["app://polaris/index.html", false],
    ["data:text/html,<p>hi</p>", false],
    ["about:blank", false],
    [`${FRAME_PREFIX}abc`, true],
  ])("a subframe loading %s: %p", (url, allowed) => {
    expect(subframeMayLoad(url)).toBe(allowed);
  });

  test("a frame's URL never counts as the app's own, so it can't call in", () => {
    expect(isTrustedUrl(`${FRAME_PREFIX}abc`, null)).toBe(false);
    expect(isTrustedUrl("app://polaris/index.html", null)).toBe(true);
  });
});
