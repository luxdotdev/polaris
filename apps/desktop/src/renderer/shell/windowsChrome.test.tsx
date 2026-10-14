import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppMenuButton, CaptionSpace } from "./windowsChrome.tsx";

describe("Windows title bar pieces", () => {
  test("the lockup is a menu button outside the drag region", () => {
    const html = renderToStaticMarkup(<AppMenuButton />);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("app-no-drag");
    expect(html).toContain('data-slot="wordmark"');
  });

  test("the caption space is hidden from assistive tech", () => {
    expect(renderToStaticMarkup(<CaptionSpace />)).toContain('aria-hidden="true"');
  });
});
