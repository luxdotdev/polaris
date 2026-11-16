/**
 * The share sheet signed in (Paper SS3): the sharing account, the person by GitHub handle, the
 * role, the expiry and what sharing allows, then who has access and the share log.
 */
import type { SessionId, ShareRole } from "@polaris/protocol";
import {
  Button,
  DialogTitle,
  Input,
  ChatIcon,
  DotIcon,
  LockIcon,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polaris/ui";
import { useCallback, useEffect, useState } from "react";
import type { PolarisAccountView } from "../../../../shared/accountsContract.ts";
import type { ShareView } from "../../../../shared/sharingContract.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { refreshSharedSessions } from "../data/feeds.ts";
import {
  bareLogin,
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_DAYS,
  type ExpiryDays,
  expiresAtFor,
  expiryNote,
  isLogin,
  shareRefusal,
} from "../model/copy.ts";
import { Access } from "./Access.tsx";

export interface ShareFormProps {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly workspaceId: string;
  readonly title: string;
  /** Signed-in Polaris accounts; at least one. */
  readonly accounts: ReadonlyArray<PolarisAccountView>;
  /** `hostKey/workspaceId` to the Account each Workspace is shared as. */
  readonly workspaces: Readonly<Record<string, string>>;
  readonly onClose: () => void;
}

/** The Workspace's sharing Account when it is signed in, else the first. */
export const defaultAccount = (
  accounts: ReadonlyArray<PolarisAccountView>,
  workspaces: Readonly<Record<string, string>>,
  hostKey: string,
  workspaceId: string
): PolarisAccountView | undefined => {
  const chosen = workspaces[`${hostKey}/${workspaceId}`];

  return accounts.find((a) => a.id === chosen) ?? accounts[0];
};

const AccountSwitch = ({
  accounts,
  value,
  onChange,
}: {
  readonly accounts: ReadonlyArray<PolarisAccountView>;
  readonly value: PolarisAccountView;
  readonly onChange: (id: string) => void;
}) => {
  const label = (a: PolarisAccountView) => `@${a.login} · ${a.serverLabel}`;

  if (accounts.length === 1)
    return <span className="text-caption text-text-default">{label(value)}</span>;

  return (
    <Select value={value.id} onValueChange={onChange}>
      <SelectTrigger aria-label="Sharing account" className="h-6 gap-1.5 px-2">
        <span className="text-caption text-text-default">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {label(a)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const Statements = ({ who }: { readonly who: string }) => (
  <ul className="text-body text-text-default flex flex-col gap-2 px-5 py-4">
    <li className="flex gap-2.5">
      <DotIcon size={14} className="text-text-subtle mt-0.5 shrink-0" />
      {who} will see everything in this session, including command output.
    </li>
    <li className="flex gap-2.5">
      <ChatIcon size={14} className="text-text-subtle mt-0.5 shrink-0" />
      {who} can comment on messages and changes, and can't send Turns or answer approvals.
    </li>
    <li className="flex gap-2.5">
      <LockIcon size={14} className="text-text-subtle mt-0.5 shrink-0" />
      Terminals, editing files and managing who has access stay yours.
    </li>
  </ul>
);

const useShares = (hostKey: string, sessionId: SessionId) => {
  const [shares, setShares] = useState<ReadonlyArray<ShareView> | null>(null);

  const reload = useCallback(
    () =>
      void polaris()
        .request("sharing.list", { hostKey, sessionId })
        .then((result) => setShares(result.ok ? result.value : [])),
    [hostKey, sessionId]
  );

  useEffect(reload, [reload]);

  return { shares, reload };
};

export const ShareForm = (props: ShareFormProps) => {
  const { hostKey, sessionId, accounts, onClose } = props;
  const fallback = defaultAccount(accounts, props.workspaces, hostKey, props.workspaceId);
  const [accountId, setAccountId] = useState(fallback?.id ?? "");
  const account = accounts.find((a) => a.id === accountId) ?? fallback;
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<ShareRole>("commenter");
  const [days, setDays] = useState<ExpiryDays>(DEFAULT_EXPIRY_DAYS);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { shares, reload } = useShares(hostKey, sessionId);
  const now = useNow();

  if (account === undefined) return null;
  const who = isLogin(login) ? `@${bareLogin(login)}` : "They";

  const share = () => {
    setBusy(true);
    setRefusal(null);
    void polaris()
      .request("sharing.share", {
        hostKey,
        sessionId,
        workspaceId: props.workspaceId,
        title: props.title,
        accountId: account.id,
        login: bareLogin(login),
        role,
        expiresAt: expiresAtFor(days, Date.now()),
      })
      .then((result) => {
        setBusy(false);

        if (!result.ok) {
          setRefusal(shareRefusal(result.error, login, account.serverLabel));

          return;
        }

        setLogin("");
        reload();
        void refreshSharedSessions(hostKey);
      });
  };

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 px-5 pt-5 pb-4">
        <DialogTitle className="truncate pr-8">Share {props.title || "this session"}</DialogTitle>
        <div className="text-caption text-text-subtle flex items-center gap-2">
          Sharing as
          <AccountSwitch accounts={accounts} value={account} onChange={setAccountId} />
        </div>
        <Input
          autoFocus
          aria-label="GitHub handle"
          placeholder="GitHub handle, like @octocat"
          value={login}
          onChange={(event) => {
            setLogin(event.target.value);
            setRefusal(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isLogin(login) && !busy) share();
          }}
          className="h-8"
        />
        {refusal === null ? null : (
          <p className="text-caption text-failed-text" role="alert" data-testid="share-refusal">
            {refusal}
          </p>
        )}
      </div>
      <div className="border-hairline grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-3 border-t px-5 py-4">
        <span className="text-body text-text-subtle">Role</span>
        <div className="flex flex-col items-start gap-1">
          <SegmentedControl<ShareRole>
            aria-label="Role"
            variant="fill"
            pill
            value={role}
            onValueChange={setRole}
            options={[
              { value: "contributor", label: "Contributor", disabled: true },
              { value: "commenter", label: "Commenter" },
            ]}
          />
        </div>
        <span />
        <span className="text-caption text-text-subtle -mt-1.5">
          Contributor comes once teammates can send Turns.
        </span>
        <span className="text-body text-text-subtle">Expires</span>
        <div className="flex items-center gap-3">
          <Select
            value={String(days)}
            onValueChange={(v) =>
              setDays(EXPIRY_DAYS.find((d) => String(d) === v) ?? DEFAULT_EXPIRY_DAYS)
            }
          >
            <SelectTrigger aria-label="Expires" className="h-7 w-auto gap-1.5 px-2.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 1 ? "In 1 day" : `In ${d} days`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-caption text-text-subtle">{expiryNote(days, now)}</span>
        </div>
      </div>
      <div className="border-hairline border-t">
        <Statements who={who} />
      </div>
      <div className="border-hairline flex items-center gap-1.5 border-t px-5 py-3">
        <span className="text-caption text-text-subtle flex-1">
          You can revoke this at any time.
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !isLogin(login)}
          data-testid="share-submit"
          onClick={share}
        >
          {isLogin(login) ? `Share with ${who}` : "Share"}
        </Button>
      </div>
      <Access hostKey={hostKey} shares={shares} onChanged={reload} />
    </div>
  );
};
