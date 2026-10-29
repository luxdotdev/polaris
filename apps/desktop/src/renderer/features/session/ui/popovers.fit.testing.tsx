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

mountPreview(document.getElementById("root")!, "#preview/session");

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
