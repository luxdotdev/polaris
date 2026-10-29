/** The session preview without a main process, its theme from the query (ENG-517). */
import "../../../styles.css";
import { HarnessMark, showToast } from "@polaris/ui";
import { polaris } from "../../bridge.ts";
import { mountPreview } from "../preview/Preview.tsx";

const query = new URLSearchParams(location.search);

const theme = query.get("theme") ?? "moonlit";

const root = document.documentElement;

root.dataset["theme"] = theme === "light" ? "light" : "dark";

root.dataset["themeDark"] = theme === "light" ? "moonlit" : theme;

root.dataset["density"] = "balanced";

root.dataset["platform"] = "darwin";

mountPreview(document.getElementById("root")!, `#preview/${query.get("scene") ?? "session"}`);

// Some hooks call the preload's API directly; here it is the preview's stand-in.
Object.assign(window, { polaris: polaris() });

/** Paper X-F 08's first toast, for the smoke to raise. */
Object.assign(window, {
  __showToast: () =>
    showToast({
      source: "codex",
      icon: <HarnessMark harness="codex" />,
      title: (
        <>
          Spike GPUI review wants to run <code>cargo build</code>
        </>
      ),
      time: "now",
      needsYou: true,
      action: { label: "Approve", onAction: () => undefined, shortcut: "⌘⇧A" },
      secondaryAction: { label: "Open session", onAction: () => undefined },
      duration: 60_000,
    }),
});

/** Five toasts at once, the first with a long title, for the break-UI pass (ENG-499). */
Object.assign(window, {
  __showToasts: () => {
    for (const n of [1, 2, 3, 4, 5])
      showToast({
        source: n % 2 === 0 ? "claude" : "codex",
        icon: <HarnessMark harness={n % 2 === 0 ? "claude" : "codex"} />,
        title:
          n === 1 ? (
            <>
              Investigate why the Daemon’s event store replays every Turn twice after a crash wants
              to run{" "}
              <code>
                POLARIS_PBT_RUNS=500 bun test apps/daemon/src/verification --rerun-each 50
              </code>
            </>
          ) : (
            `Session ${n} finished`
          ),
        time: n === 1 ? "412 days ago" : "now",
        needsYou: n === 1,
        action: { label: "Approve", onAction: () => undefined, shortcut: "⌘⇧A" },
        secondaryAction: { label: "Open session", onAction: () => undefined },
        duration: 60_000,
      });
  },
});
