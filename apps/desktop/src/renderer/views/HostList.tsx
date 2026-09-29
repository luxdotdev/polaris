import type { Workspace } from "@polaris/protocol";
import { Button, IconButton, PlusIcon, Row, SectionHeader } from "@polaris/ui";
import { useState } from "react";
import type { HostView } from "../../shared/api.ts";
import { startProofSession } from "../proof.ts";
import {
  emptyHostModel,
  type HostModel,
  type SessionEntry,
  sessionsOf,
  visibleWorkspaces,
} from "../store/hostModel.ts";
import type { Selection } from "./App.tsx";
import { connectionLabel, sessionStateLabel } from "./copy.ts";
import { SessionIcon } from "./SessionIcon.tsx";
import { useApp, useConnection } from "./hooks.ts";

interface SelectProps {
  readonly selected: Selection | null;
  readonly onSelect: (selection: Selection) => void;
  readonly onNewSession: (hostKey: string, workspaceId: Workspace["id"]) => void;
}

interface SessionRowProps extends SelectProps {
  readonly hostKey: string;
  readonly entry: SessionEntry;
}

const SessionRow = ({ hostKey, entry, selected, onSelect }: SessionRowProps) => {
  const { session, pendingApprovals, lastTurnPreview } = entry;
  const needsYou = session.state === "needs-you" || pendingApprovals.length > 0;
  const isSelected = selected?.hostKey === hostKey && selected.sessionId === session.id;
  const select = () => onSelect({ hostKey, sessionId: session.id });

  // Row's asChild can't slot (it renders several children), so the row itself is the button.
  return (
    <Row
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select();
      }}
      variant="session"
      tone={needsYou ? "needs-you" : "default"}
      selected={isSelected}
      leading={<SessionIcon state={session.state} harness={session.harness} />}
      title={session.title || "untitled"}
      description={lastTurnPreview ?? sessionStateLabel[session.state]}
      meta={<span data-testid="row-state">{sessionStateLabel[session.state]}</span>}
    />
  );
};

interface WorkspaceProps extends SelectProps {
  readonly hostKey: string;
  readonly model: HostModel;
  readonly workspace: Workspace;
}

const WorkspaceSection = ({
  hostKey,
  model,
  workspace,
  selected,
  onSelect,
  onNewSession,
}: WorkspaceProps) => {
  const sessions = sessionsOf(model, workspace.id);

  return (
    <li>
      <SectionHeader
        title={workspace.path}
        empty={sessions.length === 0 ? `No agent sessions in ${workspace.name}` : undefined}
        action={
          <IconButton
            size="sm"
            label={`New session in ${workspace.name}`}
            icon={<PlusIcon size={14} />}
            onClick={() => onNewSession(hostKey, workspace.id)}
            data-testid={`new-session-${workspace.name}`}
          />
        }
      >
        {workspace.name}
      </SectionHeader>
      <ul className="flex flex-col gap-px">
        {sessions.map((entry) => (
          <li key={entry.session.id}>
            <SessionRow
              hostKey={hostKey}
              entry={entry}
              selected={selected}
              onSelect={onSelect}
              onNewSession={onNewSession}
            />
          </li>
        ))}
      </ul>
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
    <div className="flex flex-col gap-1 px-2 py-1">
      <Button
        variant="primary"
        disabled={busy || host.status.state !== "connected"}
        onClick={start}
      >
        {busy ? "Starting…" : "Start proof session"}
      </Button>
      {error === null ? null : <p className="text-caption text-failed">{error}</p>}
    </div>
  );
};

const HostSection = ({ host, selected, onSelect, onNewSession }: HostProps) => {
  const model = useApp((s) => s.hostModels[host.key]) ?? emptyHostModel;
  const workspaces = visibleWorkspaces(model);
  const { status } = host;
  const detail = status.state === "connected" ? null : (status.failure?.detail ?? null);

  return (
    <section
      aria-label={host.label}
      data-connection={status.state}
      className="flex flex-col data-[connection=offline]:opacity-(--opacity-dimmed) data-[connection=reconnecting]:opacity-(--opacity-dimmed)"
    >
      <div className="flex items-baseline justify-between px-2 pb-1">
        <h2 className="text-label text-text-strong">{host.label}</h2>
        <span className="text-caption text-text-subtle" data-testid={`connection-${host.key}`}>
          {connectionLabel[status.state]}
        </span>
      </div>
      {detail === null ? null : <p className="text-caption text-text-subtle px-2">{detail}</p>}
      {model.fromCache ? (
        <p className="text-caption text-text-faint px-2">Last known · revalidating</p>
      ) : null}
      {host.proofHarness ? (
        <ProofButton
          host={host}
          selected={selected}
          onSelect={onSelect}
          onNewSession={onNewSession}
        />
      ) : null}
      {workspaces.length === 0 ? (
        <p className="text-caption text-text-faint px-2 py-1.5">No workspaces yet</p>
      ) : (
        <ul className="flex flex-col">
          {workspaces.map((workspace) => (
            <WorkspaceSection
              key={workspace.id}
              hostKey={host.key}
              model={model}
              workspace={workspace}
              selected={selected}
              onSelect={onSelect}
              onNewSession={onNewSession}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

export const HostList = ({ selected, onSelect, onNewSession }: SelectProps) => {
  const hosts = useApp((s) => s.hosts);

  return (
    <nav
      aria-label="Hosts"
      className="gap-section border-hairline bg-surface-sunken pt-panel flex flex-col overflow-y-auto border-r p-2"
    >
      {hosts.map((host) => (
        <HostSection
          key={host.key}
          host={host}
          selected={selected}
          onSelect={onSelect}
          onNewSession={onNewSession}
        />
      ))}
    </nav>
  );
};
