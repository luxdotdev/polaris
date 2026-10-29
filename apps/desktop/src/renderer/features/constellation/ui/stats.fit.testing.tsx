/** The tab's header under the window's title and machine bars, its Stats popover open (ENG-507). */
import "../../../styles.css";
import { TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import type { PolarisApi } from "../../../../shared/api.ts";
import { standInBridge } from "../../bridge.ts";
import { c1Record } from "../preview/graph.ts";
import { statsFixture } from "../preview/stats.ts";
import { Header } from "./header.tsx";

const theme = new URLSearchParams(location.search).get("theme") ?? "dark";

document.documentElement.dataset["theme"] = theme;

standInBridge({
  request: (method) =>
    // SAFETY: only constellation.stats is answered, with its own output type.
    Promise.resolve(
      (method === "constellation.stats"
        ? { ok: true, value: statsFixture(37) }
        : { ok: false, error: { code: "Unsupported", message: "fixture" } }) as never
    ),
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
} satisfies PolarisApi);

const record = c1Record();

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <div className="bg-bg h-screen pt-[92px]">
      <Header
        record={record}
        segments={[]}
        top={null}
        onJump={() => undefined}
        hostKey="fixture"
        statsOpen
        onStatsOpen={() => undefined}
        ledBy="led by this session"
      />
    </div>
  </TooltipProvider>
);
