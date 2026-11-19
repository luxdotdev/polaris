/**
 * Evidence for ENG-972: one file in the Editor (Lezer), as a Review diff (Pierre on
 * highlights, through the real worker pool) and through `highlightToHtml`. `?theme=light`.
 */
import "../../styles.css";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type CodeViewItem, parseDiffFromFile } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { DIFF_CLASS, DIFF_HIGHLIGHTER, DiffWorkers, THEMES } from "../diffs/index.ts";
import { loadLanguage } from "../editor/cm/languages.ts";
import { editorLook } from "../editor/cm/theme.ts";
import { highlightToHtml, themeFor } from "./index.ts";

const OLD = `import { Effect } from "effect";
import type { Host } from "./host.ts";

/** Opens the Host's socket, retrying once. */
export const connect = (host: Host, port = 22) =>
  Effect.gen(function* () {
    const socket = yield* dial(host.address, port);
    return new Session({ socket, name: \`\${host.name}:\${port}\` });
  });

export class Session {
  readonly name: string;
  close(): void {}
}
`;

const NEW = `import { Effect } from "effect";
import type { Host } from "./host.ts";

/** Opens the Host's socket, retrying once. */
export const connect = (host: Host, port = 22) =>
  Effect.gen(function* () {
    const socket = yield* dial(host.address, port, { timeout: "4 seconds" });
    // A slow Host gets one more try before the Connection State says Offline.
    yield* Effect.retry(socket.ready, { times: 1 });
    return new Session({ socket, name: \`\${host.name}:\${port}\` });
  });

export class Session {
  readonly name: string;
  close(): Promise<void> { return this.socket.end(); }
}
`;

const PATH = "src/connect.ts";

const type: "light" | "dark" =
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";

document.documentElement.dataset.theme = type;

const Editor = () => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let view: EditorView | undefined;

    void loadLanguage("typescript").then((language) => {
      if (host.current === null) return;
      view = new EditorView({
        parent: host.current,
        state: EditorState.create({ doc: NEW, extensions: [editorLook, language] }),
      });
    });

    return () => view?.destroy();
  }, []);

  return <div ref={host} className="h-full" />;
};

const items: ReadonlyArray<CodeViewItem<undefined>> = [
  {
    id: PATH,
    type: "diff",
    fileDiff: parseDiffFromFile({ name: PATH, contents: OLD }, { name: PATH, contents: NEW }),
    version: 1,
  },
];

const options = {
  theme: THEMES,
  themeType: type,
  preferredHighlighter: DIFF_HIGHLIGHTER,
  diffStyle: "unified" as const,
  diffIndicators: "classic" as const,
  lineDiffType: "word-alt" as const,
  disableFileHeader: true,
};

const Column = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) => (
  <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
    <h2 className="text-label text-text-subtle">{title}</h2>
    <div className="bg-panel min-h-0 flex-1 overflow-hidden rounded-[var(--radius-panel)]">
      {children}
    </div>
  </section>
);

const root = document.getElementById("root");

if (root === null) throw new Error("no root");

createRoot(root).render(
  <DiffWorkers>
    <div className="bg-ground text-text-default flex h-screen gap-4 p-4">
      <Column title="Editor (Lezer)">
        <Editor />
      </Column>
      <Column title="Review diff (Pierre on @pierre/highlights)">
        <CodeView<undefined, undefined>
          initialItems={items}
          options={options}
          className={`${DIFF_CLASS} h-full overflow-auto`}
        />
      </Column>
      <Column title="highlightToHtml">
        <div
          className="text-code h-full overflow-auto p-4 font-mono [&_pre]:!bg-transparent"
          // oxlint-disable-next-line react/no-danger -- highlightToHtml escapes the code it returns
          dangerouslySetInnerHTML={{ __html: highlightToHtml(NEW, "ts", themeFor(type)) }}
        />
      </Column>
    </div>
  </DiffWorkers>
);
