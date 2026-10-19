import "../../../test/dom.testing.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { HostId, LanguageCheckout, LanguagePreviewPolicy, WorkspaceId } from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageRequestOutputs,
  type LanguageRequestMethod,
} from "../../../../shared/languages.ts";
import { MarkdownPreview } from "./index.tsx";
import type { PreviewDocument } from "./targets.ts";

const doc: PreviewDocument = {
  hostKey: "local",
  hostId: HostId.make("host-1"),
  path: "/repo/docs/readme.md",
  checkout: LanguageCheckout.cases.Workspace.make({
    workspaceId: WorkspaceId.make("ws-1"),
    path: "/repo",
  }),
};

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const api = (externalImages: "ask" | "deny"): LanguageApi => ({
  request: async <M extends LanguageRequestMethod>(method: M) => {
    const output =
      method === "languages.preview.policy.get"
        ? LanguagePreviewPolicy.make({
            hostId: doc.hostId,
            workspaceId: doc.checkout.workspaceId,
            externalImages,
            scripts: "disabled",
            html: "sanitized",
            mermaid: "strict",
            maxMediaBytes: 1_048_576,
          })
        : { mimeType: "image/png", bytes: atob(PNG).length, decodedBytes: 4, base64: PNG };

    return { ok: true, value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(output) };
  },
  subscribe: () => () => {},
});

const preview = (source: string, externalImages: "ask" | "deny" = "ask") => (
  <MarkdownPreview
    api={api(externalImages)}
    hostLabel="This Mac"
    source={source}
    document={doc}
    openDocument={async () => {}}
    openExternal={async () => {}}
  />
);

const HOST_ONLY = "# Notes\n\n![Diagram](diagram.png)";

const WITH_EXTERNAL = `${HOST_ONLY}\n\n![Badge](https://img.shields.io/badge/ci-passing-green)`;

afterEach(cleanup);

describe("the external images control", () => {
  test("stays hidden when the document has no external image", async () => {
    const view = render(preview(HOST_ONLY));

    await view.findByRole("img", { name: "Diagram" });

    expect(view.queryByRole("button", { name: "Load external images" })).toBeNull();
  });

  test.each([
    ["ask", "Load external images"],
    ["deny", "External images blocked"],
  ] as const)("shows for %s while an external image is in the document", async (policy, text) => {
    const view = render(preview(WITH_EXTERNAL, policy));

    await view.findByText(text);

    view.rerender(preview(HOST_ONLY, policy));

    await waitFor(() => expect(view.queryByText(text)).toBeNull());
  });
});
