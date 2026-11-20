import { expect, test } from "bun:test";
import { Schema } from "effect";
import { inspectionView } from "../../shared/inspectionView.ts";

test("serialized renderer inspection shows view structure but excludes hidden UI and input values", () => {
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, "getClientRects");
  Object.defineProperty(Element.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 100, height: 20 }],
  });

  try {
    document.body.innerHTML = `<main role="main" aria-label="Polaris"><button role="tab" aria-selected="true">Traces</button><section role="tabpanel">Recent spans</section><div hidden>Hidden data</div><div style="display:none">Closed panel</div><input value="secret input"><textarea>secret textarea</textarea><div contenteditable="true">secret draft</div></main>`;

    const view = Schema.decodeUnknownSync(Schema.String)(
      window.eval(`(${inspectionView.toString()}).call(globalThis)`)
    );

    expect(view).toContain("main [Polaris]");
    expect(view).toContain("tab selected=true: Traces");
    expect(view).toContain("tabpanel: Recent spans");
    expect(view).not.toContain("Hidden data");
    expect(view).not.toContain("Closed panel");
    expect(view).not.toContain("secret");
  } finally {
    document.body.innerHTML = "";

    if (previous === undefined) Reflect.deleteProperty(Element.prototype, "getClientRects");
    else Object.defineProperty(Element.prototype, "getClientRects", previous);
  }
});
