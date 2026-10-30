import { describe, expect, test } from "bun:test";
import { flowChart, loanCalculator, timeline } from "../../examples/index.ts";
import { Schema } from "effect";
import {
  FRAME_TOKEN_DEFAULTS,
  FrameMessage,
  buildFrameDocument,
  type FrameDocumentOptions,
} from "../index.ts";
import { source as chartJs } from "../vendor/chartjs.ts";
import { source as d3 } from "../vendor/d3.ts";
import { runFrame } from "./run.testing.ts";

const build = (overrides: Partial<FrameDocumentOptions> = {}): string =>
  buildFrameDocument({
    html: "<p>Hello</p>",
    title: "Example",
    tokens: {},
    scheme: "dark",
    mode: "inline",
    ...overrides,
  });

const AGENT_MARK = "<!-- agent fragment -->";

describe("buildFrameDocument", () => {
  test("the CSP meta is the first thing in head, before any agent byte", () => {
    const doc = build({
      html: `${AGENT_MARK}<meta http-equiv="Content-Security-Policy" content="default-src *">`,
    });

    const head = doc.slice(doc.indexOf("<head>") + "<head>".length).trimStart();
    expect(
      head.startsWith(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'">`
      )
    ).toBe(true);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf(AGENT_MARK));
    expect(doc.includes("connect-src")).toBe(false);
  });

  test("an agent's top-level const doesn't collide with the bootstrap", () => {
    const frame = runFrame(
      build({
        mode: "expanded",
        html: `<div id="c"></div><script>
        const s = getComputedStyle(document.documentElement);
        const root = 1, config = 2, token = 3, state = 4, chart = 5, post = 6, names = 7;
        window.result = typeof pv.bind + ":" + s.getPropertyValue("--pv-bg").trim();
      </script>`,
      })
    );

    expect(frame.errors).toEqual([]);
    expect(frame.global("result")).toBe(`function:${FRAME_TOKEN_DEFAULTS.dark["--pv-bg"]}`);
  });

  test("the bootstrap leaves nothing in the global scope but pv", () => {
    const frame = runFrame(build({ mode: "expanded" }));

    const leaked = [
      "root",
      "config",
      "token",
      "state",
      "chart",
      "charts",
      "post",
      "names",
      "flow",
      "bind",
    ].filter((name) => frame.global(name) !== undefined);

    expect(leaked).toEqual([]);
    expect(frame.evaluate("typeof pv")).toBe("object");
  });

  test("the harness shares one lexical scope across scripts, as a browser does", () => {
    const frame = runFrame("<script>const s = 1;</script><script>const s = 2;</script>");
    expect(frame.errors).toEqual([expect.stringContaining("SyntaxError")]);
  });

  test("tokens that could escape the style are dropped for the scheme's default", () => {
    const doc = build({
      scheme: "light",
      tokens: {
        "--pv-bg": "red</style><script>alert(1)</script>",
        "--pv-text": "x".repeat(129),
        "--pv-accent": "#123 } .escaped-rule { color: red",
        "pv-series-1": "#abcdef",
        "--pv-unknown": "#000000",
      },
    });

    const frame = runFrame(doc);
    const value = (name: string) => frame.evaluate(`pv.token(${JSON.stringify(name)})`);
    expect([doc.includes("alert(1)"), doc.includes("escaped-rule")]).toEqual([false, false]);
    const light = FRAME_TOKEN_DEFAULTS.light;
    expect([value("bg"), value("text"), value("accent")]).toEqual([
      light["--pv-bg"],
      light["--pv-text"],
      light["--pv-accent"],
    ]);
    expect(value("series-1")).toBe("#abcdef");
    expect(value("unknown")).toBe("");
  });

  test("the title is escaped", () => {
    const doc = build({ title: `</title><script>alert("t")</script>` });
    expect(doc).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;</title>"
    );
  });

  test("saved state is restored before the agent's script runs", () => {
    const frame = runFrame(
      build({
        state: { pv: 1, value: { selected: 2, note: "</script><b>" }, tabs: {} },
        html: "<script>window.seen = pv.state.get();</script>",
      })
    );

    expect(frame.global("seen")).toEqual({ selected: 2, note: "</script><b>" });
  });

  test("libraries are inlined only when the fragment uses them, unless all are asked for", () => {
    const has = (doc: string) => [doc.includes(chartJs), doc.includes(d3)];
    expect(has(build(flowChart))).toEqual([false, true]);
    expect(has(build(loanCalculator))).toEqual([true, false]);
    expect(has(build(timeline))).toEqual([false, false]);
    expect(has(build({ ...timeline, libraries: "all" }))).toEqual([true, true]);
  });
});

describe("the frame runtime", () => {
  test("pv:theme from the host updates the tokens live and tells the page", () => {
    const frame = runFrame(
      build({
        html: "<script>window.themes = []; pv.onTheme(() => themes.push(pv.scheme));</script>",
      })
    );

    const { window } = frame;
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: {
          type: "pv:theme",
          scheme: "light",
          tokens: { "--pv-bg": "#fafafa", "pv-series-2": "#010203", "--pv-accent": "a<b" },
        },
      })
    );
    const style = window.document.documentElement.style;
    expect([style.getPropertyValue("--pv-bg"), style.getPropertyValue("--pv-series-2")]).toEqual([
      "#fafafa",
      "#010203",
    ]);
    expect(style.getPropertyValue("--pv-accent")).toBe("");
    expect(frame.global("themes")).toEqual(["light"]);
  });

  test("a theme message from another window is ignored", () => {
    const frame = runFrame(build());
    const { window } = frame;
    const other = runFrame("").window;
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: other,
        data: { type: "pv:theme", scheme: "light", tokens: { "--pv-bg": "#fafafa" } },
      })
    );
    expect(window.document.documentElement.style.getPropertyValue("--pv-bg")).toBe("");
  });

  test("pv.state.set and pv.openLink post their messages; non-https links are refused", () => {
    const frame = runFrame(build({ mode: "expanded" }));
    frame.run(
      `pv.state.set({ step: 3 }); pv.openLink("http://example.com"); pv.openLink("javascript:alert(1)"); pv.openLink("https://example.com/a b")`
    );
    expect(frame.posted).toEqual([
      { type: "pv:state", state: { pv: 1, value: { step: 3 }, tabs: {} } },
      { type: "pv:open-link", url: "https://example.com/a%20b" },
    ]);
  });

  const TABS = `<div class="pv-tabs" role="tablist" id="view">
    <button role="tab" aria-selected="true" aria-controls="a">A</button>
    <button role="tab" aria-selected="false" aria-controls="b">B</button></div>
    <div role="tabpanel" id="a">A</div><div role="tabpanel" id="b" hidden>B</div>`;

  test("a chosen tab is saved beside the agent's state and restored", () => {
    const first = runFrame(build({ mode: "expanded", html: TABS }));
    first.run(`pv.state.set("mine"); document.querySelectorAll("[role=tab]")[1].click();`);
    const saved = Schema.decodeUnknownSync(FrameMessage)(first.posted.at(-1));

    if (saved.type !== "pv:state") throw new Error(`expected pv:state, got ${saved.type}`);
    const second = runFrame(build({ mode: "expanded", html: TABS, state: saved.state }));
    const hidden = (id: string) => second.evaluate(`document.getElementById("${id}").hidden`);
    expect([hidden("a"), hidden("b"), second.evaluate("pv.state.get()")]).toEqual([
      true,
      false,
      "mine",
    ]);
  });

  test("clicking a link never navigates: https is offered, anything else does nothing", () => {
    const frame = runFrame(
      build({
        mode: "expanded",
        html: '<a id="ok" href="https://example.com/x">x</a><a id="no" href="http://example.com/y">y</a>',
      })
    );

    const clicked = ["ok", "no"].map((id) =>
      frame.evaluate(
        `(() => { const e = new MouseEvent("click", { bubbles: true, cancelable: true }); document.getElementById("${id}").dispatchEvent(e); return e.defaultPrevented; })()`
      )
    );

    expect(clicked).toEqual([true, true]);
    expect(frame.posted).toEqual([{ type: "pv:open-link", url: "https://example.com/x" }]);
  });

  test("an inline frame reports its height; an expanded one doesn't", async () => {
    const inline = runFrame(build({ mode: "inline" }));
    const expanded = runFrame(build({ mode: "expanded" }));
    await Bun.sleep(200);

    const types = (posted: ReadonlyArray<unknown>) =>
      posted.map((message) => Schema.decodeUnknownSync(FrameMessage)(message).type);

    expect([types(inline.posted), types(expanded.posted)]).toEqual([["pv:height"], []]);
  });

  test("pv.bind runs the update at once and on input, with values by id", () => {
    const frame = runFrame(
      build({
        mode: "expanded",
        html: `<label class="pv-slider"><span>Rate</span><output></output><input type="range" id="rate" min="1" max="9" value="4" data-suffix="%"></label>
        <script>window.calls = []; pv.bind("#rate", (v) => calls.push(v.rate));</script>`,
      })
    );

    frame.run(
      `const input = document.getElementById("rate"); input.value = "7"; input.dispatchEvent(new Event("input"));`
    );
    expect(frame.global("calls")).toEqual([4, 7]);
    expect(frame.window.document.querySelector("output")?.textContent).toBe("7%");
  });

  // Chart.js's responsive sizing needs layout happy-dom lacks; scripts/browser-check.ts runs those.
  test.each([
    ["flow chart", flowChart],
    ["timeline", timeline],
  ] as const)("the %s example runs without throwing", (_name, example) => {
    expect(runFrame(build({ ...example, mode: "expanded" })).errors).toEqual([]);
  });
});
