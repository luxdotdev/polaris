/**
 * Settings → Polaris accounts (DESIGN.md, Shared Sessions "Accounts"; Paper SS5): each Account
 * with its server, GitHub login, commit email and Workspaces, adding one, and which Account
 * each Workspace is shared as.
 */
import {
  Badge,
  Button,
  cn,
  DotsIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SettingsButton,
  SettingsCard,
  SettingsEmpty,
  SettingsPage,
  SettingsSelect,
  SettingsWell,
} from "@polaris/ui";
import { useState } from "react";
import type { PolarisAccountsView } from "../../../../shared/accountsContract.ts";
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { useNow } from "../../../shell/useNow.ts";
import { usePolarisAccounts } from "../../accounts/index.ts";
import { polaris } from "../../bridge.ts";
import {
  accountsSummary,
  type PolarisAccountRow,
  polarisAccountRows,
} from "../model/polarisAccounts.ts";
import { sectionInfo } from "../model/sections.ts";
import type { WorkspaceOption } from "../model/workspaces.ts";
import { AddPolarisAccount } from "./AddPolarisAccount.tsx";
import { useWorkspaceOptions, WorkspaceOverrides } from "./WorkspaceOverrides.tsx";

const Avatar = ({ row }: { readonly row: PolarisAccountRow }) =>
  row.avatar === null ? (
    <span
      aria-hidden
      className={cn(
        "bg-surface-raised text-caption text-text-default flex size-[26px] shrink-0 items-center justify-center rounded-full font-medium",
        row.signedOut && "opacity-(--opacity-dimmed)"
      )}
    >
      {row.initials}
    </span>
  ) : (
    <img
      alt=""
      src={row.avatar}
      className={cn(
        "size-[26px] shrink-0 rounded-full",
        row.signedOut && "opacity-(--opacity-dimmed)"
      )}
    />
  );

const signOut = (id: string) => void polaris().request("accounts.signOut", { accountId: id });

const AccountMenu = ({ row }: { readonly row: PolarisAccountRow }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={`More for ${row.handle}`}>
        <DotsIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem className="text-failed-text" onSelect={() => signOut(row.id)}>
        Sign out of {row.handle} on {clientCopy().machine}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const AccountRow = ({
  row,
  onSignInAgain,
}: {
  readonly row: PolarisAccountRow;
  readonly onSignInAgain: () => void;
}) => (
  <div
    className="px-panel flex items-start gap-3 py-[calc(var(--spacing-gap)+4px)]"
    data-testid="polaris-account"
  >
    <Avatar row={row} />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="text-body text-text-default truncate">{row.handle}</span>
        <Badge className="h-[18px] text-[11px]">{row.badge}</Badge>
      </span>
      <span className="text-caption text-text-subtle truncate">
        <span className={cn(row.serverIsUrl && "font-mono")}>{row.server}</span> · {row.status}
      </span>
      {row.workspaces === null ? null : (
        <span className="text-caption text-text-subtle truncate">{row.workspaces}</span>
      )}
    </span>
    {row.signedOut ? (
      <SettingsButton variant="ghost" onClick={onSignInAgain}>
        Sign in again
      </SettingsButton>
    ) : (
      <span className="w-[220px] shrink-0">
        <SettingsSelect
          label={`Commit email for ${row.handle}`}
          value={row.commitEmail}
          options={row.commitEmails.map((email) => ({ value: email, label: email }))}
          onChange={(commitEmail) =>
            void polaris().request("accounts.commitEmail.set", { accountId: row.id, commitEmail })
          }
        />
      </span>
    )}
    <AccountMenu row={row} />
  </div>
);

const AccountsCard = ({
  view,
  options,
  adding,
  onAdd,
}: {
  readonly view: PolarisAccountsView;
  readonly options: ReadonlyArray<WorkspaceOption>;
  readonly adding: boolean;
  readonly onAdd: () => void;
}) => {
  const now = useNow();
  const rows = polarisAccountRows(view, options, now);

  return (
    <SettingsCard
      title="Accounts"
      aside={rows.length === 0 ? undefined : accountsSummary(view, clientCopy().machine)}
      status={view.storageAvailable ? "Signs in with GitHub" : clientCopy().noTokenStore}
      action={
        adding ? undefined : (
          <SettingsButton variant="primary" disabled={!view.storageAvailable} onClick={onAdd}>
            Add account
          </SettingsButton>
        )
      }
    >
      {rows.length === 0 ? (
        <SettingsEmpty>No Polaris account on {clientCopy().machine} yet</SettingsEmpty>
      ) : (
        <SettingsWell aria-label="Polaris accounts">
          {rows.map((row) => (
            <AccountRow key={row.id} row={row} onSignInAgain={onAdd} />
          ))}
        </SettingsWell>
      )}
      {rows.length === 0 ? null : (
        <p className="text-caption text-text-subtle px-gap">
          The commit email is a verified address on the GitHub account; it credits your shared
          turns.
        </p>
      )}
    </SettingsCard>
  );
};

const setWorkspace = (
  options: ReadonlyArray<WorkspaceOption>,
  key: string,
  accountId: string | null
) => {
  const option = options.find((o) => o.key === key);

  if (option !== undefined)
    void polaris().request("accounts.workspace.set", {
      workspace: { hostKey: option.hostKey, workspaceId: option.workspaceId },
      accountId,
    });
};

/** Which Account each Workspace is shared as: set at its first Share, changed here. */
const SharingAccounts = ({
  view,
  options,
}: {
  readonly view: PolarisAccountsView;
  readonly options: ReadonlyArray<WorkspaceOption>;
}) => {
  const first = view.accounts[0];

  if (first === undefined) return null;

  const accountOptions = view.accounts.map((a) => ({
    value: a.id,
    label: `@${a.login} · ${a.serverLabel}`,
    short: `@${a.login}`,
  }));

  return (
    <section className="flex flex-col gap-2" aria-label="Sharing account per workspace">
      <h2 className="text-heading-sm text-text-strong px-gap">Sharing account per workspace</h2>
      <WorkspaceOverrides
        label="Sharing account per workspace"
        keys={Object.keys(view.workspaces).filter((key) => options.some((o) => o.key === key))}
        options={options}
        addLabel="Each workspace is shared as the Polaris account chosen at its first share."
        onAdd={(key) => setWorkspace(options, key, first.id)}
        onRemove={(key) => setWorkspace(options, key, null)}
        control={(key) => (
          <span className="w-[200px] shrink-0">
            <SettingsSelect
              label="Polaris account"
              value={view.workspaces[key]}
              options={accountOptions}
              onChange={(id) => setWorkspace(options, key, id)}
            />
          </span>
        )}
      />
    </section>
  );
};

const Body = ({ view }: { readonly view: PolarisAccountsView }) => {
  const options = useWorkspaceOptions();
  const [adding, setAdding] = useState(false);
  const count = view.accounts.length;
  const [counted, setCounted] = useState(count);

  // An Account just added closes Add account.
  if (count !== counted) {
    setCounted(count);

    if (count > counted) setAdding(false);
  }

  const showAdd = adding || view.signIn !== null;

  return (
    <>
      <AccountsCard view={view} options={options} adding={showAdd} onAdd={() => setAdding(true)} />
      {showAdd ? <AddPolarisAccount view={view} onClose={() => setAdding(false)} /> : null}
      {view.accounts.length === 0 ? null : <SharingAccounts view={view} options={options} />}
    </>
  );
};

export const PolarisAccountsPage = () => {
  const view = usePolarisAccounts();
  const info = sectionInfo("account");

  return (
    <SettingsPage title={info.title} blurb={info.blurb}>
      {view === null ? (
        <p className="text-caption text-text-subtle px-gap">Loading accounts…</p>
      ) : (
        <Body view={view} />
      )}
    </SettingsPage>
  );
};
