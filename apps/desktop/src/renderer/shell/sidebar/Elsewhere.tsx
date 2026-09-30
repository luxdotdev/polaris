import type { WorkspaceId } from "@polaris/protocol";
import { SectionHeader } from "@polaris/ui";
import { useMemo } from "react";
import { needsYou } from "../../routes/topBar.ts";
import type { SessionEntry } from "../../store/hostModel.ts";
import { useApp } from "../hooks.ts";
import { CompactSessionRow } from "./SessionRow.tsx";

interface ElsewhereProps {
  readonly hostKey: string;
  /** The Workspace in view (Workspace bar); null lists other machines only (machine bar). */
  readonly workspaceId: WorkspaceId | null;
}

interface Waiting {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly where: string;
}

/** Sessions that need you outside what the sidebar shows: the Workspace, or the machine. */
export const Elsewhere = ({ hostKey, workspaceId }: ElsewhereProps) => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  const waiting = useMemo(() => {
    const found: Array<Waiting> = [];

    for (const host of hosts) {
      const model = models[host.key];

      if (model === undefined || (workspaceId === null && host.key === hostKey)) continue;

      for (const entry of model.sessions.values()) {
        const here = host.key === hostKey && entry.session.workspaceId === workspaceId;

        if (!needsYou(entry) || here) continue;
        const workspace = model.workspaces.get(entry.session.workspaceId);

        found.push({
          hostKey: host.key,
          entry,
          where: host.key === hostKey ? (workspace?.name ?? host.label) : host.label,
        });
      }
    }

    return found;
  }, [hosts, models, hostKey, workspaceId]);

  if (waiting.length === 0) return null;

  return (
    <div className="flex flex-col px-2 pt-4">
      <SectionHeader>
        {workspaceId === null ? "Needs you on other machines" : "Needs you elsewhere"}
      </SectionHeader>
      {waiting.map((w) => (
        <CompactSessionRow
          key={`${w.hostKey}/${w.entry.session.id}`}
          hostKey={w.hostKey}
          entry={w.entry}
          now={0}
          meta={w.where}
        />
      ))}
    </div>
  );
};
