/** Smoke check that the Editor status bar's language pill is on screen, not covered by the pane. */
import { strict as assert } from "node:assert";
import { Schema } from "effect";
import type { Page } from "playwright-core";

const Hit = Schema.Struct({ onScreen: Schema.Boolean, covered: Schema.Boolean, by: Schema.String });

/** A long file with no diagnostics: taller than the window, as in the slice 8 fixtures. */
export const longFile = (line: (index: number) => string, count = 120) =>
  Array.from({ length: count }, (_, index) => line(index)).join("\n") + "\n";

/** Hit-tests the pill's centre, so a pane drawn over the bar fails even though the pill is in the DOM. */
export async function assertStatusBarShown(page: Page, name: string) {
  const pill = page.getByTestId("language-pill");
  await pill.waitFor({ timeout: 60000 });

  const hit = Schema.decodeUnknownSync(Hit)(
    await page.evaluate(`(() => {
    const element = document.querySelector('[data-testid="language-pill"]');
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      onScreen: box.bottom <= window.innerHeight && box.height > 0,
      covered: top === null || !element.contains(top),
      by: top === null ? "nothing" : (top.getAttribute("data-testid") ?? String(top.className)),
    };
  })()`)
  );

  assert(hit.onScreen, `${name}: the language pill is off screen`);
  assert(!hit.covered, `${name}: the language pill is covered by ${hit.by}`);
}
