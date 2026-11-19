/**
 * Evidence for inline edits (ENG-979): every state of a file change through the real `Item`,
 * patches built by the protocol's `filePatch`. `?theme=light` switches the look.
 */
import "../../../../styles.css";
import "../../../../app/slots.tsx";
import { filePatch, TurnItem } from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { completedItemView, liveItemView } from "../../model/items.ts";
import { Item } from "../items.tsx";
import { chooseCollapse } from "../../model/collapse.ts";

const BEFORE = `export const layout = (variant: number) => {
  const main = document.querySelector("main");
  main.className = "grid-2";
  return main;
};
`;

const AFTER = `export const layout = (variant: number) => {
  const main = document.querySelector("main");
  main.className = "variant";
  main.dataset.v = String(variant);
  // The rail holds the Workspace list.
  const rail = document.createElement("aside");
  rail.className = "rail";
  main.append(rail);
  return main;
};
`;

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Orchestrator layouts</title>
    <link rel="stylesheet" href="./variants.css" />
  </head>
  <body>
    <main class="variant" data-v="3">
      <aside class="rail">…</aside>
    </main>
  </body>
</html>
`;

type FileChangeItem = Extract<TurnItem, { readonly _tag: "FileChange" }>;

interface Running {
  readonly status: "running";
  readonly writing: boolean;
}

const make = (id: string, changes: FileChangeItem["changes"], extra?: Running) =>
  TurnItem.cases.FileChange.make({ id, changes, status: "completed", ...extra });

const ITEMS: ReadonlyArray<[string, FileChangeItem]> = [
  [
    "Writing (tool input streaming)",
    make("w", [{ path: "prototypes/orchestrator-layout/index.html", kind: "add" }], {
      status: "running",
      writing: true,
    }),
  ],
  [
    "Edit, folded to 8 changed lines",
    make("e", [
      {
        path: "prototypes/orchestrator-layout/serve.ts",
        kind: "modify",
        patch: filePatch(BEFORE, AFTER),
      },
    ]),
  ],
  [
    "Edit, opened in place",
    make("o", [
      {
        path: "prototypes/orchestrator-layout/serve.ts",
        kind: "modify",
        patch: filePatch(BEFORE, AFTER),
      },
    ]),
  ],
  [
    "Write that creates a file",
    make("n", [
      {
        path: "prototypes/orchestrator-layout/index.html",
        kind: "add",
        patch: filePatch("", HTML),
      },
    ]),
  ],
  [
    "Truncated patch: counts only",
    make("t", [
      {
        path: "dist/bundle.js",
        kind: "modify",
        patch: { diff: "", added: 4210, removed: 388, truncated: true },
      },
    ]),
  ],
  [
    "A Daemon without file patches",
    make("x", [
      { path: "src/app.ts", kind: "modify" },
      { path: "src/old.ts", kind: "delete" },
    ]),
  ],
  [
    "Several files (a command's Changed 2 files)",
    make("s", [
      {
        path: "CONTEXT.md",
        kind: "modify",
        patch: filePatch(
          "- **Turn**: one exchange.\n",
          "- **Turn**: one exchange, from prompt to reply.\n"
        ),
      },
      {
        path: "docs/old-notes.md",
        kind: "delete",
        patch: filePatch("# Notes\n\nSuperseded.\n", ""),
      },
    ]),
  ],
];

chooseCollapse("edit:o:prototypes/orchestrator-layout/serve.ts", true);

const params = new URLSearchParams(location.search);

const light = params.get("theme") === "light";

document.documentElement.dataset.theme = light ? "light" : "dark";

const store = createStore<AppState>(() => ({ ...initialState, theme: light ? "light" : "dark" }));

const connection: Connection = {
  store,
  openSession: () => () => {},
  setDensity: (density) => store.setState({ density }),
  setAppearance: (patch) => store.setState(patch),
};

const root = document.getElementById("root");

if (root === null) throw new Error("no root");

const view = (item: FileChangeItem) =>
  item.status === "running"
    ? liveItemView(item.id, { item, text: "", output: "" })
    : completedItemView(item);

createRoot(root).render(
  <AppProvider
    value={{
      connection,
      navigation: createNavigation({ app: store, storage: null }),
      commands: createCommandRegistry({ platform: "mac" }),
    }}
  >
    <TooltipProvider>
      <div className="bg-bg text-text-default flex w-[620px] flex-col gap-3 p-5">
        {ITEMS.map(([label, item]) => (
          <div key={item.id} className="flex flex-col gap-1">
            <div className="text-caption text-text-faint">{label}</div>
            <Item item={view(item)} hue="claude-code" onOpenDiff={() => {}} onOpenFile={() => {}} />
          </div>
        ))}
      </div>
    </TooltipProvider>
  </AppProvider>
);
