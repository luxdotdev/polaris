import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { HostId, WorkspaceId, LanguageCheckout, LanguagePreviewPolicy } from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageRequestOutputs,
  type LanguageRequestInput,
  type LanguageRequestMethod,
} from "../../../../shared/languages.ts";
import { Schema } from "effect";
import { MarkdownPreview } from "./index.tsx";
import { Markdown } from "../../session/ui/markdown/index.tsx";
import type { PreviewDocument } from "./targets.ts";

const document: PreviewDocument = {
  hostKey: "fake-linux",
  hostId: HostId.make("host-fixture"),
  path: "/fixture/docs/readme.md",
  checkout: LanguageCheckout.cases.Workspace.make({
    workspaceId: WorkspaceId.make("ws-fixture"),
    path: "/fixture",
  }),
};

let policy = LanguagePreviewPolicy.make({
  hostId: document.hostId,
  workspaceId: document.checkout.workspaceId,
  externalImages: "ask",
  scripts: "disabled",
  html: "sanitized",
  mermaid: "strict",
  maxMediaBytes: 10485760,
});

const calls: Array<string> = [];

const revoked: Array<string> = [];

const created: Array<string> = [];

const create = URL.createObjectURL.bind(URL);

const revoke = URL.revokeObjectURL.bind(URL);

URL.createObjectURL = (blob) => {
  const url = create(blob);
  created.push(url);

  return url;
};

URL.revokeObjectURL = (url) => {
  revoked.push(url);
  revoke(url);
};

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const api: LanguageApi = {
  request: async <M extends LanguageRequestMethod>(method: M, input: LanguageRequestInput<M>) => {
    calls.push(method);
    let output: LanguagePreviewPolicy | { mimeType: string; bytes: number; base64: string };

    if (method === "languages.preview.policy.get") output = policy;
    else if (method === "languages.preview.policy.set") {
      policy = Schema.decodeUnknownSync(Schema.Struct({ policy: LanguagePreviewPolicy }))(
        input
      ).policy;
      output = policy;
    } else output = { mimeType: "image/png", bytes: atob(png).length, base64: png };
    const value = Schema.decodeUnknownSync(LanguageRequestOutputs[method])(output);

    return { ok: true, value };
  },
  subscribe: () => () => {},
};

const content = `# Unsaved preview

| Feature | Result |
| --- | --- |
| GFM | ready |

- [x] task complete
- [ ] task remaining

~~removed~~ and https://example.com

[Relative guide](guide.md#intro) · [Jump](#unsaved-preview) · [Blocked](javascript:alert(1))

![Host image](../image.png) ![External image](https://external.invalid/image.png)

<details><summary>Sanitized HTML</summary>Safe content</details>
<script>window.compromised=true</script><iframe src="https://external.invalid/iframe"></iframe>
<picture><source srcset="https://external.invalid/bypass.png" /><img src="https://external.invalid/raw.png" onerror="window.compromised=true" /></picture>

\`\`\`typescript
const greeting = "moonlit";
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Source] --> B[Preview]
\`\`\`

\`\`\`diff
- old value
+ new value
\`\`\`
`;

const Fixture = () => {
  const [source, setSource] = useState(
    new URLSearchParams(location.search).has("plain")
      ? "# Plain unsaved source\n\nNo heavy plugins needed."
      : content
  );

  const [mode, setMode] = useState("preview");
  const [connected, setConnected] = useState(true);

  return (
    <>
      <div style={{ padding: 8, display: "flex", gap: 8 }}>
        <button onClick={() => setMode("preview")}>Preview</button>
        <button onClick={() => setSource(content)}>Full sample</button>
        <button onClick={() => setMode("control")}>Control</button>
        <button onClick={() => setMode("closed")}>Close</button>
        <button onClick={() => setConnected(!connected)}>Toggle Host</button>
        <textarea
          aria-label="Current unsaved source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </div>
      <main style={{ height: "calc(100vh - 80px)", overflow: "auto" }}>
        {mode === "preview" && (
          <MarkdownPreview
            source={source}
            document={document}
            api={connected ? api : undefined}
            hostLabel="Fake Linux"
            openDocument={async (target, fragment) => {
              calls.push(`open:${target.hostKey}:${target.path}#${fragment}`);
            }}
            openExternal={async (url) => {
              calls.push(`external:${url}`);
            }}
          />
        )}
        {mode === "control" && (
          <div className="markdown-preview">
            <Markdown text={source} live={false} />
          </div>
        )}
      </main>
    </>
  );
};

Object.assign(window, { fixture: { calls, created, revoked } });

const root = window.document.getElementById("root");

if (root !== null) createRoot(root).render(<Fixture />);
