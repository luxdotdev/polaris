/**
 * Review with no subject open: the pull request list (Paper R3, DESIGN.md Review → Pull
 * requests). Every Workspace on every Host matched by git remote, hidden ones included;
 * Review requested / Mine / Other open; an account filter; "Review a PR by URL".
 */
import { Button, cn, EmptyState, PixelCheckIcon, PixelForkIcon, PixelKeyIcon } from "@polaris/ui";
import { type KeyboardEvent, useMemo, useState } from "react";
import type { OpenPull } from "../../../../shared/api.ts";
import type { WorkspaceRef } from "../../../../shared/github.ts";
import { openPull, openSessionReview } from "../../../routes/review.ts";
import { connectionLabel } from "../../../shell/copy.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { useNow } from "../../../shell/useNow.ts";
import type { AppState } from "../../../store/store.ts";
import { sessionsOf } from "../../review/model/sessions.ts";
import { checkoutsByPull } from "../model/checkouts.ts";
import { type GroupId, listModel, type PlaceOf, type RowModel } from "../model/list.ts";
import { noticesOf } from "../model/notices.ts";
import { usePulls } from "../store.ts";
import { AccountMark } from "./AccountMark.tsx";
import { ByUrl } from "./ByUrl.tsx";
import { NoticeRow } from "./Notice.tsx";
import { LANES, PullRow, ROW_X } from "./PullRow.tsx";
import { useRiskLanes } from "./useRiskLanes.ts";

const placeOfFrom =
  (hosts: AppState["hosts"], models: AppState["hostModels"]): PlaceOf =>
  (ref: WorkspaceRef) => {
    const host = hosts.find((h) => h.key === ref.hostKey);

    if (host === undefined) return null;

    return {
      workspace: models[ref.hostKey]?.workspaces.get(ref.workspaceId)?.name ?? null,
      hostLabel: host.label,
      connected: host.status.state === "connected",
      state: connectionLabel[host.status.state],
    };
  };

/** ↑/↓ between rows, as in the sidebar. */
const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-pull-row]")];
  const index = rows.findIndex((row) => row === document.activeElement);
  const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];

  if (index === -1 || next === undefined) return;
  event.preventDefault();
  next.focus();
};

const Header = ({ caption }: { readonly caption: string | null }) => (
  <div className="flex flex-col gap-1">
    <h1 className="text-display text-text-strong font-medium tracking-[-0.015em]">Pull requests</h1>
    {caption === null ? null : (
      <p className="text-caption text-text-subtle" data-testid="pulls-caption">
        {caption}
      </p>
    )}
  </div>
);

const ColumnHeads = () => (
  <div
    className={cn(
      "border-hairline text-caption text-text-subtle flex h-(--spacing-tree-row) shrink-0 items-center border-b",
      ROW_X
    )}
  >
    <span className="w-(--spacing-tree-row) shrink-0" />
    <span className="min-w-0 flex-1">Pull request</span>
    <span className={cn(LANES.workspace, "shrink-0")}>Workspace</span>
    <span className={cn(LANES.changes, "shrink-0")}>Changes</span>
    <span className={cn(LANES.risk, "shrink-0")}>Risk</span>
    <span className={cn(LANES.updated, "shrink-0 text-right")}>Updated</span>
  </div>
);

interface AccountFilterProps {
  readonly accounts: ReadonlyArray<{
    readonly id: number;
    readonly login: string;
    readonly avatarUrl: string;
  }>;
  readonly value: number | null;
  readonly onChange: (id: number | null) => void;
}

const segment = (on: boolean) =>
  cn(
    "flex h-6 cursor-default items-center gap-1.5 rounded-[5px] px-2.5 text-caption",
    on
      ? "bg-fill-selected text-text-strong font-medium"
      : "text-text-subtle hover:text-text-default"
  );

const AccountFilter = ({ accounts, value, onChange }: AccountFilterProps) => {
  if (accounts.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Accounts"
      className="rounded-control border-hairline bg-surface-sunken flex h-[30px] shrink-0 items-center gap-0.5 border p-0.5"
    >
      <button
        type="button"
        aria-pressed={value === null}
        className={segment(value === null)}
        onClick={() => onChange(null)}
      >
        All accounts
      </button>
      {accounts.map((account, index) => (
        <button
          key={account.id}
          type="button"
          aria-pressed={value === account.id}
          className={segment(value === account.id)}
          onClick={() => onChange(account.id)}
        >
          <AccountMark index={index} />
          {account.login}
        </button>
      ))}
    </div>
  );
};

/** Nobody signed in, no keychain, or nothing open: one pane (DESIGN.md, Empty states). */
const Empty = ({
  kind,
  onAddAccount,
}: {
  readonly kind: "signed-out" | "no-keychain" | "none" | "loading";
  readonly onAddAccount: () => void;
}) => {
  if (kind === "loading")
    return (
      <EmptyState
        icon={<PixelForkIcon size={24} />}
        title="Checking GitHub"
        fact="Pull requests appear here as they load"
      />
    );

  if (kind === "no-keychain") {
    return (
      <EmptyState
        icon={<PixelKeyIcon size={24} />}
        title="Polaris can’t keep a GitHub sign-in here"
        fact="This computer has no keychain Polaris can use, so it won’t store a token"
      />
    );
  }

  if (kind === "signed-out") {
    return (
      <EmptyState
        data-testid="pulls-signed-out"
        icon={<PixelForkIcon size={24} />}
        title="Sign in to GitHub to see pull requests"
        fact="Pull requests for every workspace on every host, matched by git remote"
        action={
          <Button variant="secondary" onClick={onAddAccount}>
            Add GitHub account
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      data-testid="pulls-empty"
      icon={<PixelCheckIcon size={24} />}
      title="No open pull requests"
      fact="None requests your review, none are yours, and none are open in your workspaces’ repos"
    />
  );
};

export interface PullListProps {
  /** Settings → GitHub accounts. */
  readonly onAddAccount: () => void;
}

export const PullList = ({ onAddAccount }: PullListProps) => {
  const list = usePulls((s) => s.list);
  const accounts = usePulls((s) => s.accounts);
  const dismissed = usePulls((s) => s.dismissed);
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const actions = useShellActions();
  const now = useNow(30_000);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<GroupId>>(new Set());

  const placeOf = useMemo(() => placeOfFrom(hosts, models), [hosts, models]);
  const found = useMemo(() => checkoutsByPull(models), [models]);
  const riskOf = useRiskLanes(found);
  const sessions = useMemo(() => sessionsOf(models), [models]);

  const model = useMemo(() => {
    if (list === null) return null;

    const hostOf = (hostKey: string) => {
      const host = hosts.find((h) => h.key === hostKey);

      return host === undefined
        ? null
        : {
            hostLabel: host.label,
            connected: host.status.state === "connected",
            state: connectionLabel[host.status.state],
          };
    };

    const checkouts = new Map(
      [...found].map(([pull, f]) => [
        pull,
        hosts.find((h) => h.key === f.hostKey)?.label ?? f.hostKey,
      ])
    );

    return listModel({
      list,
      accounts,
      accountId,
      placeOf,
      checkouts,
      riskOf,
      sessions,
      hostOf,
      expanded,
      now,
    });
  }, [list, accounts, accountId, placeOf, found, riskOf, sessions, hosts, expanded, now]);

  const notices = useMemo(
    () =>
      list === null
        ? []
        : noticesOf({ list, hostLabelOf: (ref) => placeOf(ref)?.hostLabel ?? null, dismissed }),
    [list, placeOf, dismissed]
  );

  const open = (pull: OpenPull) => openPull(actions, pull);

  const openRow = (row: RowModel) =>
    row.kind === "pull" ? open(row.pull) : openSessionReview(actions, row.hostKey, row.sessionId);

  const signedIn = accounts?.accounts.some((a) => a.state === "ok") ?? false;

  const empty = (() => {
    if (accounts === null) return "loading";

    if (!accounts.storageAvailable && !signedIn) return "no-keychain";

    if (!signedIn) return "signed-out";

    if (model === null || list?.updatedAt === null) return "loading";

    return model.total === 0 ? "none" : null;
  })();

  return (
    <section
      data-testid="pull-list"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-[calc(var(--spacing-section)-4px)] overflow-y-auto px-[calc(var(--spacing-section)+16px)] pt-(--spacing-tree-row) pb-[calc(var(--spacing-section)+16px)]"
    >
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <Header
            caption={
              empty === "signed-out" || empty === "no-keychain"
                ? null
                : (model?.caption ?? "Checking GitHub…")
            }
          />
        </div>
        <AccountFilter accounts={model?.accounts ?? []} value={accountId} onChange={setAccountId} />
        <ByUrl onOpen={open} />
      </div>
      {notices.map((notice) => (
        <NoticeRow key={notice.key} notice={notice} onAddAccount={onAddAccount} />
      ))}
      {empty !== null || model === null ? (
        <Empty kind={empty ?? "loading"} onAddAccount={onAddAccount} />
      ) : (
        <div className="flex flex-col gap-0.5" onKeyDown={moveFocus} role="presentation">
          <ColumnHeads />
          {model.groups.map((group) => (
            <div
              key={group.id}
              className="flex flex-col gap-0.5"
              data-testid={`pulls-group-${group.id}`}
            >
              <h2 className="text-caption text-text-subtle flex items-center gap-2 px-[calc(var(--spacing-row-x)+2px)] pt-[calc(var(--spacing-gap)+6px)] pb-[calc(var(--spacing-gap)-2px)]">
                {group.label}
                <span className="tabular">{group.count}</span>
              </h2>
              {group.rows.map((row) => (
                <PullRow key={row.id} row={row} onOpen={openRow} />
              ))}
              {group.more === 0 ? null : (
                <button
                  type="button"
                  className={cn(
                    "text-caption text-text-subtle hover:text-text-default flex h-[calc(var(--spacing-row)+4px)] cursor-default items-center text-left",
                    ROW_X
                  )}
                  onClick={() => setExpanded(new Set([...expanded, group.id]))}
                >
                  <span className="w-(--spacing-tree-row) shrink-0" />
                  Show {group.more} more
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
