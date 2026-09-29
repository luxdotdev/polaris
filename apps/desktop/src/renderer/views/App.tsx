import type { SessionId, WorkspaceId } from "@polaris/protocol";
import { useState } from "react";
import { NewSessionPage, SessionView } from "../features/session/index.ts";
import { HostList } from "./HostList.tsx";
import { TitleBar } from "./TitleBar.tsx";

export interface Selection {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

/** Where a new session would start: the new-session page for this Workspace. */
export interface NewIn {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
}

const Placeholder = () => (
  <section className="text-body text-text-faint grid place-items-center">
    Select an agent session
  </section>
);

/** The app shell with the M1 proof screen: Hosts, Workspaces, Agent Sessions, one open session. */
export const App = () => {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [newIn, setNewIn] = useState<NewIn | null>(null);

  const select = (selection: Selection) => {
    setNewIn(null);
    setSelected(selection);
  };

  const main = () => {
    if (newIn !== null)
      return (
        <NewSessionPage
          hostKey={newIn.hostKey}
          workspaceId={newIn.workspaceId}
          onStarted={(sessionId) => select({ hostKey: newIn.hostKey, sessionId })}
        />
      );

    if (selected === null) return <Placeholder />;

    return (
      <SessionView
        key={`${selected.hostKey}:${selected.sessionId}`}
        hostKey={selected.hostKey}
        sessionId={selected.sessionId}
        onOpenSession={(sessionId) => select({ hostKey: selected.hostKey, sessionId })}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
        <HostList
          selected={newIn === null ? selected : null}
          onSelect={select}
          onNewSession={(hostKey, workspaceId) => setNewIn({ hostKey, workspaceId })}
        />
        {main()}
      </main>
    </div>
  );
};
