/**
 * Settings → GitHub accounts' "Account per owner" (Paper S5): an account per owner or org,
 * each owner's access problem with its one fix, "Everyone else" on the default, and the
 * Workspaces that override their owner.
 */
import {
  Button,
  ChevronDownIcon,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polaris/ui";
import type { GitHubAccountsView, PullListView } from "../../../../shared/github.ts";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { AccountMark } from "../../pulls/index.ts";
import { type OwnerRow, ownerTable, workspaceOverrides } from "../model/github.ts";
import { workspaceLabel } from "../model/workspaces.ts";
import {
  OverrideStrip,
  overrideCount,
  useWorkspaceOptions,
  WorkspaceOverrides,
} from "./WorkspaceOverrides.tsx";

/** The Select value that clears a mapping (the default account answers). */
const DEFAULT = "default";

const AccountSelect = ({
  view,
  value,
  label,
  onChange,
}: {
  readonly view: GitHubAccountsView;
  readonly value: number | null;
  readonly label: string;
  readonly onChange: (accountId: number | null) => void;
}) => {
  const index = view.accounts.findIndex((a) => a.id === value);

  return (
    <Select
      value={value === null ? "" : String(value)}
      onValueChange={(v) => onChange(v === DEFAULT ? null : Number(v))}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "px-gap w-[180px] gap-2",
          value === null
            ? "text-caption text-text-default font-regular data-[placeholder]:text-text-default border-dashed bg-transparent"
            : "bg-surface-sunken"
        )}
      >
        {index < 0 ? null : <AccountMark index={index} />}
        <span className="flex-1 truncate text-left">
          <SelectValue placeholder="Choose account" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {view.accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.login}
          </SelectItem>
        ))}
        {value === null ? null : <SelectItem value={DEFAULT}>Use the default</SelectItem>}
      </SelectContent>
    </Select>
  );
};

const recheck = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");

  void polaris().request("github.recheck", { repo: { owner, name } });
};

const openExternal = (url: string) => void polaris().request("shell.openExternal", { url });

/** The owner's access problem, neutral (DESIGN.md: a notice, never a signal colour). */
const AccessLine = ({ row }: { readonly row: OwnerRow }) => {
  const { access } = row;

  if (access.kind === "ok") return null;

  if (access.kind === "not-found") {
    return (
      <div className="flex items-center gap-2 pt-1">
        <span className="text-caption text-text-subtle flex-1">
          No account here can see {access.repo}. Choose one that can, or add it.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-caption text-text-subtle flex-1">
        {row.owner} hasn&apos;t approved Polaris, so {access.repo} is hidden
      </span>
      {/* One action per row (DESIGN.md, Settings); its menu holds the three ways in. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs">
            Get access
            <ChevronDownIcon size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {access.approvalUrl === null ? null : (
            <DropdownMenuItem onSelect={() => openExternal(access.approvalUrl ?? "")}>
              Request access from {row.owner}
            </DropdownMenuItem>
          )}
          {access.ssoUrl === null ? null : (
            <DropdownMenuItem onSelect={() => openExternal(access.ssoUrl ?? "")}>
              Sign in with SSO
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => recheck(access.repo)}>Check again</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const Owner = ({ row, view }: { readonly row: OwnerRow; readonly view: GitHubAccountsView }) => (
  <div className="px-panel py-gap flex flex-col" data-testid="github-owner">
    <div className="min-h-tree-row flex items-center gap-3">
      <span className="text-body text-text-default flex-1 truncate">{row.owner}</span>
      <span className="text-caption text-text-subtle w-[120px] shrink-0 truncate">
        {row.workspaces}
      </span>
      <AccountSelect
        view={view}
        value={row.accountId}
        label={`Account for ${row.owner}`}
        onChange={(accountId) =>
          void polaris().request("github.routing.setOwner", { owner: row.owner, accountId })
        }
      />
    </div>
    <AccessLine row={row} />
  </div>
);

const Overrides = ({
  view,
  pulls,
}: {
  readonly view: GitHubAccountsView;
  readonly pulls: PullListView | null;
}) => {
  const options = useWorkspaceOptions().filter((o) => o.isGitRepo);
  const overrides = workspaceOverrides(view, pulls);
  const login = (id: number | null) => view.accounts.find((a) => a.id === id)?.login ?? "another";

  const set = (key: string, accountId: number | null) => {
    const option = options.find((o) => o.key === key);

    const [hostKey = "", workspaceId = ""] =
      option === undefined ? key.split("/") : [option.hostKey, option.workspaceId];

    void polaris().request("github.routing.setWorkspace", {
      workspace: { hostKey, workspaceId },
      accountId,
    });
  };

  const [first] = overrides;

  const detail =
    first === undefined
      ? null
      : `${workspaceLabel(options, first.key)} uses ${login(first.accountId)}${first.insteadOf === null ? "" : ` instead of ${login(first.insteadOf)}`}`;

  return (
    <OverrideStrip summary={overrideCount(overrides.length, "its owner")} detail={detail}>
      <WorkspaceOverrides
        label="Workspace accounts"
        keys={overrides.map((o) => o.key)}
        options={options}
        addLabel="A workspace can use another account than its owner's."
        onAdd={(key) => set(key, view.accounts[0]?.id ?? null)}
        onRemove={(key) => set(key, null)}
        control={(key) => (
          <AccountSelect
            view={view}
            value={view.workspaces[key] ?? null}
            label="Account for this workspace"
            onChange={(accountId) => set(key, accountId)}
          />
        )}
      />
    </OverrideStrip>
  );
};

export const OwnerTable = ({
  view,
  pulls,
}: {
  readonly view: GitHubAccountsView;
  readonly pulls: PullListView | null;
}) => {
  const hosts = useApp((s) => s.hosts);
  const hostLabel = (key: string) => hosts.find((h) => h.key === key)?.label ?? key;
  const table = ownerTable(view, pulls, hostLabel);
  const fallback = view.accounts[0];

  return (
    <>
      <section aria-label="Account per owner" className="flex flex-col gap-3 pt-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-sm text-text-strong font-medium">Account per owner</h2>
          <p className="text-body text-text-subtle">
            Matched by each workspace&apos;s git remote. New owners use the default until you
            choose.
          </p>
        </div>
        <div className="rounded-card border-hairline divide-hairline flex flex-col divide-y overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)]">
          <div className="h-row px-panel text-caption text-text-subtle flex items-center gap-3">
            <span className="flex-1">Owner</span>
            <span className="w-[120px] shrink-0">Workspaces</span>
            <span className="w-[180px] shrink-0">Account</span>
          </div>
          {table.rows.map((row) => (
            <Owner key={row.owner} row={row} view={view} />
          ))}
          <div className="px-panel py-gap flex items-center gap-3">
            <span className="text-body text-text-subtle min-h-tree-row flex flex-1 items-center">
              Everyone else
            </span>
            <span className="text-caption text-text-subtle w-[120px] shrink-0">
              {table.everyoneElse}
            </span>
            <span className="px-gap text-caption text-text-subtle flex w-[180px] shrink-0 items-center gap-2">
              <AccountMark index={0} />
              {fallback?.login ?? "—"} · default
            </span>
          </div>
        </div>
      </section>
      <Overrides view={view} pulls={pulls} />
    </>
  );
};
