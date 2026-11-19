/**
 * Evidence for script edits (ENG-980): commands with the files they changed, through the real
 * `Item`, patches built by the protocol's `filePatch`. `?theme=light` switches the look.
 */
import "../../../styles.css";
import "../../../app/slots.tsx";
import { filePatch, type ItemFileChange, TurnItem } from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { completedItemView } from "../model/items.ts";
import { Item } from "./items.tsx";

const PYTHON = `python3 - <<'EOF'
from pathlib import Path
p = Path("apps/daemon/src/git/snapshot.ts")
p.write_text(p.read_text().replace("STALE_LOCK_MS = 60_000", "STALE_LOCK_MS = 30_000"))
EOF`;

const BEFORE = `/** An \`index.lock\` older than this was left by a crashed Daemon. */
const STALE_LOCK_MS = 60_000;

const decoder = new TextDecoder();
`;

const command = (id: string, text: string, changes: ReadonlyArray<ItemFileChange>, more = 0) => {
  const item = TurnItem.cases.CommandExecution.make({
    id,
    command: text,
    cwd: "/w",
    output: "",
    exitCode: 0,
    status: "completed",
    changes,
  });

  return more === 0 ? item : TurnItem.cases.CommandExecution.make({ ...item, moreChanges: more });
};

const names = (count: number): Array<ItemFileChange> =>
  Array.from({ length: count }, (_, i) => ({
    path: `packages/ui/src/icons/icon-${String(i).padStart(2, "0")}.tsx`,
    kind: "modify",
  }));

const ITEMS = [
  [
    "A python heredoc that edits one file",
    command("p", PYTHON, [
      {
        path: "apps/daemon/src/git/snapshot.ts",
        kind: "modify",
        patch: filePatch(BEFORE, BEFORE.replace("60_000", "30_000")),
      },
    ]),
  ],
  [
    "sed -i with a backup, and a redirect",
    command("s", "sed -i.bak 's/5173/5291/' vite.config.ts && echo 5291 > .port", [
      { path: ".port", kind: "add", patch: filePatch("", "5291\n") },
      {
        path: "vite.config.ts",
        kind: "modify",
        patch: filePatch("  server: { port: 5173 },\n", "  server: { port: 5291 },\n"),
      },
      {
        path: "vite.config.ts.bak",
        kind: "add",
        patch: filePatch("", "  server: { port: 5173 },\n"),
      },
    ]),
  ],
  [
    "A tree too large to snapshot quickly: names from the turn's diff",
    command("n", "bun run codegen", [
      { path: "packages/protocol/src/generated/rpcs.ts", kind: "modify" },
      { path: "packages/protocol/src/generated/old.ts", kind: "delete" },
    ]),
  ],
  ["Many files, folded to 8, with more counted", command("m", "bun run format", names(12), 1030)],
  ["A command that changed nothing", command("x", "bun test apps/daemon/src/git", [])],
] as const;

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
            <Item
              item={completedItemView(item)}
              hue="claude-code"
              onOpenDiff={() => {}}
              onOpenFile={() => {}}
            />
          </div>
        ))}
      </div>
    </TooltipProvider>
  </AppProvider>
);
