import { strict as assert } from "node:assert";
import { describe, expect, test } from "bun:test";
import { HostId, WorkspaceId, LanguageCheckout, LanguagePreviewPolicy } from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import { previewHeadings } from "./headings.ts";
import { previewDiagrams, safeDiagramSource } from "./diagrams.ts";
import { PreviewMediaPool } from "./media.ts";
import { previewTarget, type PreviewDocument } from "./targets.ts";

export const document: PreviewDocument = {
  hostKey: "fake-linux",
  hostId: HostId.make("host-fake"),
  checkout: LanguageCheckout.cases.Workspace.make({
    workspaceId: WorkspaceId.make("ws-fake"),
    path: "/fixture",
  }),
  path: "/fixture/docs/readme.md",
};

const policy = LanguagePreviewPolicy.make({
  hostId: document.hostId,
  workspaceId: document.checkout.workspaceId,
  externalImages: "ask",
  html: "sanitized",
  scripts: "disabled",
  mermaid: "strict",
  maxMediaBytes: 10,
});

const media = { mimeType: "image/png", bytes: 3, base64: "AQID" };

const adapter = (read: () => Promise<typeof media>): LanguageApi => ({
  request: async () => {
    return { ok: true, value: await read() };
  },
  subscribe: () => () => {},
});

describe("preview Host routing", () => {
  test("resolves against the Markdown directory, preserves correct Host and fragment", () => {
    expect(previewTarget("../image%20name.png", document)).toEqual({
      kind: "file",
      path: "/fixture/image name.png",
      relativePath: "../image name.png",
      fragment: "",
    });
    expect(previewTarget("guide.md#hello", document)).toEqual({
      kind: "file",
      path: "/fixture/docs/guide.md",
      relativePath: "guide.md",
      fragment: "hello",
    });
    expect(previewTarget("#hello", document)).toEqual({ kind: "fragment", fragment: "hello" });
  });
  test("blocks escape, active schemes, credentials, query paths and malformed encoding", () => {
    for (const href of [
      "../../secret",
      "%2e%2e/%2e%2e/secret",
      "%2fetc/passwd",
      "//evil.test/a",
      "file:///etc/a",
      "data:image/svg+xml,x",
      "javascript:alert(1)",
      "https://u:p@example.com/a",
      "a%00.png",
      "a%5c.png",
      "a?download=1",
      "%zz",
    ]) {
      expect(previewTarget(href, document).kind).toBe("blocked");
    }

    expect(previewTarget("https://example.com/image.png", document).kind).toBe("external");
  });
});

describe("bounded media lifecycle", () => {
  test("denied external media never invokes the bridge", async () => {
    let calls = 0;

    const pool = new PreviewMediaPool(
      adapter(async () => {
        calls++;

        return media;
      }),
      document,
      policy
    );

    await assert.rejects(pool.acquire("https://example.com/a.png"), /blocked/);
    expect(calls).toBe(0);
  });
  test("releases each object URL once on release/disposal", async () => {
    const revoked: Array<string> = [];
    let next = 0;

    const pool = new PreviewMediaPool(
      adapter(async () => media),
      document,
      policy,
      { create: () => `blob:${++next}`, revoke: (url) => revoked.push(url) },
      20,
      2
    );

    const a = await pool.acquire("a.png");
    const b = await pool.acquire("b.png");
    await assert.rejects(pool.acquire("c.png"), /limit/);
    a.release();
    a.release();
    pool.dispose();
    b.release();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
    await assert.rejects(pool.acquire("a.png"), /limit/);
  });
  test("late replies after close never create object URLs", async () => {
    let complete: (value: typeof media) => void = () => {};

    let creates = 0;

    const pool = new PreviewMediaPool(
      adapter(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      ),
      document,
      policy,
      {
        create: () => {
          creates++;

          return "blob:x";
        },
        revoke: () => {},
      }
    );

    const pending = pool.acquire("a.png");
    pool.dispose();
    complete(media);
    await assert.rejects(pending, /closed/);
    expect(creates).toBe(0);
  });
  test("rejects non-raster, corrupt byte counts and oversized responses before allocation", async () => {
    for (const reply of [
      { ...media, mimeType: "image/svg+xml" },
      { ...media, bytes: 4 },
      { ...media, bytes: 12, base64: "AQIDAQIDAQIDAQID" },
    ]) {
      let creates = 0;

      const pool = new PreviewMediaPool(
        adapter(async () => reply),
        document,
        policy,
        {
          create: () => {
            creates++;

            return "blob:x";
          },
          revoke: () => {},
        }
      );

      await assert.rejects(pool.acquire("a.png"));
      expect(creates).toBe(0);
    }
  });
});

test("strict diagrams reject source configuration and external resource nodes", () => {
  expect(safeDiagramSource("flowchart LR\n A --> B")).toBe(true);

  for (const source of [
    '%%{init: {"securityLevel":"loose"}}%%',
    "---\nconfig: {}",
    'A@{img: "https://example.com/a"}',
    "<img src=x>",
    'A@{icon: "fetchable"}',
  ]) {
    expect(safeDiagramSource(source)).toBe(false);
  }
});

test("pending media requests reserve the full bounded response before dispatch", async () => {
  let complete: (value: typeof media) => void = () => {};

  let calls = 0;

  const pool = new PreviewMediaPool(
    adapter(() => {
      calls++;

      return new Promise((resolve) => {
        complete = resolve;
      });
    }),
    document,
    policy,
    { create: () => "blob:pending", revoke: () => {} },
    10
  );

  const first = pool.acquire("first.png");
  await assert.rejects(pool.acquire("second.png"), /limit/);
  expect(calls).toBe(1);
  complete(media);
  (await first).release();
  pool.dispose();
});

test("heading fragments are stable and count duplicates over formatted content", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "h2",
        properties: {},
        children: [
          { type: "text", value: "Hello " },
          { type: "element", tagName: "strong", children: [{ type: "text", value: "World" }] },
        ],
      },
      {
        type: "element",
        tagName: "h2",
        properties: {},
        children: [{ type: "text", value: "Hello World" }],
      },
    ],
  };

  previewHeadings()(tree);
  expect(tree.children.map((heading) => heading.properties)).toEqual([
    { id: "preview-hello-world", tabIndex: -1 },
    { id: "preview-hello-world-1", tabIndex: -1 },
  ]);
  previewHeadings()(tree);
  expect(tree.children[1]?.properties).toEqual({ id: "preview-hello-world-1", tabIndex: -1 });
});

test("quoted Mermaid resource keys never reach the rendering engine", async () => {
  let renders = 0;

  const plugin = previewDiagrams({
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: () => ({
      initialize: () => {},
      render: async () => {
        renders++;

        return { svg: "<svg></svg>" };
      },
    }),
  });

  const engine = plugin.getMermaid();
  await assert.rejects(
    engine.render("unsafe", 'flowchart LR\n A@{"img": "https://bad.invalid/image"}'),
    /unsupported/
  );
  expect(renders).toBe(0);
  await engine.render("safe", "flowchart LR\n A --> B");
  expect(renders).toBe(1);
});
