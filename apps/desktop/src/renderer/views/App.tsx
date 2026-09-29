import { useState } from "react";
import type { SessionId } from "@polaris/protocol";
import { HostList } from "./HostList.tsx";
import { SessionPanel } from "./SessionPanel.tsx";
import { TitleBar } from "./TitleBar.tsx";

export interface Selection {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

/** The app shell with the M1 proof screen: Hosts, Workspaces, Agent Sessions, one open session. */
export const App = () => {
  const [selected, setSelected] = useState<Selection | null>(null);

  return (
    <div className="shell">
      <TitleBar />
      <main className="panes">
        <HostList selected={selected} onSelect={setSelected} />
        <SessionPanel selection={selected} />
      </main>
    </div>
  );
};
