import { useState } from "react";
import type { Workspace } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import { startProofSession } from "../proof.ts";
import {
  emptyHostModel,
  type HostModel,
  sessionsOf,
  visibleWorkspaces,
} from "../store/hostModel.ts";
import type { Selection } from "./App.tsx";
import { connectionLabel, sessionStateLabel } from "./copy.ts";
import { useApp, useConnection } from "./hooks.ts";

interface SelectProps {
  readonly selected: Selection | null;
  readonly onSelect: (selection: Selection) => void;
}

interface WorkspaceProps extends SelectProps {
  readonly hostKey: string;
  readonly model: HostModel;
  readonly workspace: Workspace;
}

const WorkspaceRows = ({ hostKey, model, workspace, selected, onSelect }: WorkspaceProps) => {
  const sessions = sessionsOf(model, workspace.id);

  return (
    <li className="workspace">
      <div className="workspace-name" title={workspace.path}>
        {workspace.name}
      </div>
      {sessions.length === 0 ? (
        <div className="empty-row">no agent sessions</div>
      ) : (
        <ul className="sessions">
          {sessions.map(({ session, pendingApprovals }) => (
            <li key={session.id}>
              <button
                type="button"
                className="session-row"
                data-state={session.state}
                aria-current={selected?.hostKey === hostKey && selected.sessionId === session.id}
                onClick={() => onSelect({ hostKey, sessionId: session.id })}
              >
                <span className="state-dot" aria-hidden />
                <span className="session-title">{session.title || "untitled"}</span>
                <span className="session-state">
                  {sessionStateLabel[session.state]}
                  {pendingApprovals.length > 0 ? ` · ${pendingApprovals.length}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

interface HostProps extends SelectProps {
  readonly host: HostView;
}

const ProofButton = ({ host, onSelect }: HostProps) => {
  const { store } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setBusy(true);
    setError(null);
    startProofSession({ api: window.polaris, store, hostKey: host.key })
      .then((sessionId) => onSelect({ hostKey: host.key, sessionId }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="proof">
      <button
        type="button"
        className="button"
        disabled={busy || host.status.state !== "connected"}
        onClick={start}
      >
        {busy ? "Starting…" : "Start proof session"}
      </button>
      {error === null ? null : <span className="error">{error}</span>}
    </div>
  );
};

const HostSection = ({ host, selected, onSelect }: HostProps) => {
  const model = useApp((s) => s.hostModels[host.key]) ?? emptyHostModel;
  const workspaces = visibleWorkspaces(model);
  const { status } = host;

  return (
    <section className="host" data-connection={status.state} aria-label={host.label}>
      <header className="host-header">
        <span className="host-name">{host.label}</span>
        <span className="connection" data-testid={`connection-${host.key}`}>
          {connectionLabel[status.state]}
        </span>
      </header>
      {status.failure === null || status.state === "connected" ? null : (
        <div className="host-detail">{status.failure.detail}</div>
      )}
      {model.fromCache ? <div className="host-detail">last known · revalidating</div> : null}
      {host.proofHarness ? (
        <ProofButton host={host} selected={selected} onSelect={onSelect} />
      ) : null}
      {workspaces.length === 0 ? (
        <div className="empty-row">no workspaces</div>
      ) : (
        <ul className="workspaces">
          {workspaces.map((workspace) => (
            <WorkspaceRows
              key={workspace.id}
              hostKey={host.key}
              model={model}
              workspace={workspace}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export const HostList = ({ selected, onSelect }: SelectProps) => {
  const hosts = useApp((s) => s.hosts);

  return (
    <nav className="sidebar" aria-label="Hosts">
      {hosts.map((host) => (
        <HostSection key={host.key} host={host} selected={selected} onSelect={onSelect} />
      ))}
    </nav>
  );
};
