import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppMenuButton, CAPTION_BUTTONS, CaptionSpace } from "./windowsChrome.tsx";

describe("Windows title bar pieces", () => {
  test("the lockup is a menu button outside the drag region", () => {
    const html = renderToStaticMarkup(<AppMenuButton />);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("app-no-drag");
    expect(html).toContain('data-slot="wordmark"');
  });

  test("the caption space follows the overlay's geometry, 138px when unknown", () => {
    expect(CAPTION_BUTTONS).toContain("env(titlebar-area-width");
    expect(CAPTION_BUTTONS).toContain("138px");
    expect(renderToStaticMarkup(<CaptionSpace />)).toContain('aria-hidden="true"');
  });
});
