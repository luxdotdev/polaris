import type { SessionId } from "@polaris/protocol";
import { useState } from "react";
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
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
        <HostList selected={selected} onSelect={setSelected} />
        <SessionPanel selection={selected} />
      </main>
    </div>
  );
};
