/**
 * Under the share sheet's form (Paper SS3): the people with access, each renewable and
 * revocable, then the share log of every Share of the session, newest first.
 */
import { ShareId } from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { useState } from "react";
import type { ShareView } from "../../../../shared/sharingContract.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { refreshSharedSessions } from "../data/feeds.ts";
import { logTime, personName, shareLine, shareLog } from "../model/copy.ts";
import { PersonAvatar } from "./Avatar.tsx";

const Kicker = ({ children }: { readonly children: React.ReactNode }) => (
  <h3 className="text-micro text-text-subtle font-mono tracking-[0.08em] uppercase">{children}</h3>
);

const PersonRow = ({
  hostKey,
  share,
  now,
  onChanged,
}: {
  readonly hostKey: string;
  readonly share: ShareView;
  readonly now: number;
  readonly onChanged: () => void;
}) => {
  const [busy, setBusy] = useState(false);

  const act = (method: "sharing.renew" | "sharing.revoke") => {
    setBusy(true);
    const shareId = ShareId.make(share.id);

    const sent =
      method === "sharing.renew"
        ? polaris().request(method, { hostKey, shareId, expiresAt: null })
        : polaris().request(method, { hostKey, shareId });

    void sent.then(() => {
      setBusy(false);
      onChanged();
      void refreshSharedSessions(hostKey);
    });
  };

  return (
    <li className="flex items-center gap-3 py-1.5" data-testid="share-person">
      <PersonAvatar person={share.person} size={26} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text-strong truncate">{personName(share.person)}</span>
        <span className="text-caption text-text-subtle truncate">{shareLine(share, now)}</span>
      </span>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => act("sharing.renew")}>
        Renew
      </Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => act("sharing.revoke")}>
        Revoke
      </Button>
    </li>
  );
};

export const Access = ({
  hostKey,
  shares,
  onChanged,
}: {
  readonly hostKey: string;
  /** Null while they load. */
  readonly shares: ReadonlyArray<ShareView> | null;
  readonly onChanged: () => void;
}) => {
  const now = useNow();

  if (shares === null || shares.length === 0) return null;
  const live = shares.filter((s) => s.live);
  const log = shareLog(shares);

  return (
    <div className="bg-surface-sunken border-hairline flex flex-col gap-4 border-t px-5 py-4">
      {live.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          <Kicker>People with access · {live.length}</Kicker>
          <ul className="flex flex-col">
            {live.map((share) => (
              <PersonRow
                key={share.id}
                hostKey={hostKey}
                share={share}
                now={now}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2" data-testid="share-log">
        <Kicker>Share log</Kicker>
        <ol className="flex flex-col gap-1.5">
          {log.map((row) => (
            <li key={row.key} className="flex gap-4">
              <span className="text-caption text-text-subtle w-16 shrink-0 font-mono">
                {logTime(row.at, now)}
              </span>
              <span className="text-body text-text-default">{row.line}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
