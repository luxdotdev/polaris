import { expect, test } from "bun:test";
import { fixtureHtml } from "./html.ts";

test("joint HTML keeps existing containers and resolves only fixture-root scripts", () => {
  const source =
    '<body><div id="root"></div><div id="editor"></div><script src="/evidence.tsx"></script></body>';

  const ordinary = fixtureHtml(source, "apps/fixture/evidence.html", false);
  expect(ordinary).toContain('src="/apps/fixture/evidence.tsx"');
  expect(ordinary).toContain('<div id="editor"></div>');
  expect(ordinary).not.toContain("native-discard");
  expect(fixtureHtml(source, "apps/fixture/evidence.html", true)).toContain(
    'src="/tooling/language-fixtures/joint/native-discard.testing.ts"'
  );
});
