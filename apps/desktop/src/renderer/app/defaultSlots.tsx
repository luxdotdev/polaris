/**
 * Placeholder slot contents, until each feature lands (see app/slots.tsx).
 * They keep the shell usable end to end: the sessions that need you.
 */
import { needsYou } from "../routes/topBar.ts";
import { useApp } from "../shell/hooks.ts";
import { CompactSessionRow } from "../shell/sidebar/SessionRow.tsx";

const Pending = ({ children }: { readonly children: string }) => (
  <div className="p-panel text-body text-text-faint grid flex-1 place-items-center text-center">
    {children}
  </div>
);

export const DefaultNoSession = () => <Pending>No agent sessions in this workspace yet.</Pending>;

export const DefaultNeedsYouInbox = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  const waiting = hosts.flatMap((host) =>
    [...(models[host.key]?.sessions.values() ?? [])].flatMap((entry) =>
      needsYou(entry) ? [{ host, entry }] : []
    )
  );

  if (waiting.length === 0) return <Pending>Nothing needs you.</Pending>;

  return (
    <div className="flex flex-col px-2 pt-2">
      {waiting.map(({ host, entry }) => (
        <CompactSessionRow
          key={`${host.key}/${entry.session.id}`}
          hostKey={host.key}
          entry={entry}
          now={0}
          meta={host.label}
        />
      ))}
    </div>
  );
};
