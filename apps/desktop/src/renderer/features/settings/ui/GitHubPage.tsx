/**
 * Settings → GitHub accounts (Paper S5, S6): the accounts in routing order (the first is
 * the default), adding one through the device flow, which account each owner uses with
 * each owner's access, and the Workspaces that override their owner.
 */
import {
  Badge,
  Button,
  cn,
  DotsIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PlusIcon,
} from "@polaris/ui";
import { useEffect, useRef } from "react";
import type { GitHubAccountsView, PullListView } from "../../../../shared/github.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { AccountMark, usePulls } from "../../pulls/index.ts";
import { type AccountRow, accountRows } from "../model/github.ts";
import { sectionInfo } from "../model/sections.ts";
import { AddGitHubAccount } from "./AddGitHubAccount.tsx";
import { GitHubEnterprise } from "./GitHubEnterprise.tsx";
import { OwnerTable } from "./GitHubOwners.tsx";
import { Column, PageHeader } from "./parts.tsx";

const startSignIn = (host?: string) =>
  void polaris().request("github.signIn.start", host === undefined ? {} : { host });

const openExternal = (url: string) => void polaris().request("shell.openExternal", { url });

/** Moves `id` to the front: the default is the first account. */
const makeDefault = (view: GitHubAccountsView, id: number) =>
  void polaris().request("github.accounts.reorder", {
    accountIds: [id, ...view.accounts.map((a) => a.id).filter((a) => a !== id)],
  });

const AccountMenu = ({
  row,
  view,
}: {
  readonly row: AccountRow;
  readonly view: GitHubAccountsView;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={`More for ${row.login}`}>
        <DotsIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {row.isDefault ? null : (
        <DropdownMenuItem onSelect={() => makeDefault(view, row.id)}>Make default</DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => startSignIn(row.host)}>Sign in again</DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() =>
          openExternal(view.hosts?.find((h) => h.host === row.host)?.manageUrl ?? view.manageUrl)
        }
      >
        Manage Polaris on GitHub
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="text-failed-text"
        onSelect={() => void polaris().request("github.accounts.remove", { accountId: row.id })}
      >
        Remove {row.login} from this Mac
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const Account = ({
  row,
  view,
}: {
  readonly row: AccountRow;
  readonly view: GitHubAccountsView;
}) => (
  <div
    className="px-panel py-gap flex min-h-[calc(var(--spacing-session-row)+8px)] shrink-0 items-center gap-3"
    data-testid="github-account"
  >
    <AccountMark
      index={row.index}
      size={null}
      className={cn("size-harness-tile", row.signedOut && "opacity-(--opacity-dimmed)")}
    />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="text-body text-text-strong truncate font-medium">{row.login}</span>
        {row.isDefault ? <Badge className="h-[18px] text-[11px]">Default</Badge> : null}
      </span>
      <span
        className={
          row.signedOut
            ? "text-caption text-text-default truncate"
            : "text-caption text-text-subtle truncate"
        }
      >
        {row.caption}
      </span>
    </span>
    {row.since === null ? null : (
      <span className="text-caption text-text-subtle shrink-0">{row.since}</span>
    )}
    {row.signedOut ? (
      <Button size="xs" onClick={() => startSignIn(row.host)}>
        Sign in again
      </Button>
    ) : null}
    <AccountMenu row={row} view={view} />
  </div>
);

const AddRow = ({ view }: { readonly view: GitHubAccountsView }) => (
  <div className="flex items-center gap-3">
    <Button variant="primary" disabled={!view.storageAvailable} onClick={() => startSignIn()}>
      <PlusIcon size={12} />
      Add account
    </Button>
    <span className="text-caption text-text-subtle">
      {view.storageAvailable
        ? "Signs in through github.com with a one-time code"
        : "This Mac has no keychain to keep tokens in, so Polaris can't sign in"}
    </span>
  </div>
);

/** Settings → GitHub accounts opened to add one (the K menu, the PR list): start at once. */
const useStartWhenAdding = (adding: boolean, view: GitHubAccountsView | null) => {
  const started = useRef(false);

  useEffect(() => {
    if (!adding || started.current || view === null) return;
    started.current = true;

    if (view.signIn === null && view.storageAvailable) startSignIn();
  }, [adding, view]);
};

const Body = ({
  view,
  pulls,
}: {
  readonly view: GitHubAccountsView;
  readonly pulls: PullListView | null;
}) => {
  const now = useNow();
  const rows = accountRows(view, now);

  return (
    <>
      {rows.length === 0 ? null : (
        <section
          aria-label="Accounts"
          className="rounded-card border-hairline divide-hairline flex flex-col divide-y overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)]"
        >
          {rows.map((row) => (
            <Account key={row.id} row={row} view={view} />
          ))}
        </section>
      )}
      {view.signIn === null ? <AddRow view={view} /> : <AddGitHubAccount flow={view.signIn} />}
      {view.signIn === null ? null : (
        <div className="text-caption text-text-subtle flex flex-col gap-1.5 px-1 leading-[18px] text-pretty">
          <p>
            GitHub asks you to grant <code className="font-mono">repo</code>, full read and write
            access to every repository the account can reach (GitHub has no read-only scope for
            private repositories), and <code className="font-mono">read:org</code>. Polaris uses it
            to list pull requests, send your reviews and open pull requests you accept; hosts push
            code with their own git credentials.
          </p>
          <p>
            Already signed in to {view.signIn?.host ?? "github.com"} as another account? Open the
            link in a private window, or switch accounts on GitHub first. Next you choose which
            owners use the new account.
          </p>
        </div>
      )}
      {rows.length === 0 ? null : <OwnerTable view={view} pulls={pulls} />}
      <GitHubEnterprise view={view} />
    </>
  );
};

export const GitHubPage = ({ adding }: { readonly adding: boolean }) => {
  const view = usePulls((s) => s.accounts);
  const pulls = usePulls((s) => s.list);
  const info = sectionInfo("github");
  const hosts = useApp((s) => s.hosts.length);

  useStartWhenAdding(adding, view);

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {view === null ? (
        <p className="text-caption text-text-subtle">Loading accounts…</p>
      ) : (
        <Body view={view} pulls={hosts === 0 ? null : pulls} />
      )}
    </Column>
  );
};
