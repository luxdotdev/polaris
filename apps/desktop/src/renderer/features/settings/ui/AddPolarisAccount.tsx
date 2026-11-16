/**
 * Add account (Paper SS5): Polaris Cloud preselected, "Use your own server" with its URL, then
 * "Sign in with GitHub" in the system browser, or a code typed on any signed-in browser.
 */
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { ArrowUpRightIcon, Badge, Button, cn, CopyButton, Input, SettingsCard } from "@polaris/ui";
import { useState } from "react";
import type {
  AccountSignInView,
  PolarisAccountsView,
} from "../../../../shared/accountsContract.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { codeExpiry } from "../model/polarisAccounts.ts";

const CLOUD_HOST = new URL(POLARIS_CLOUD_ACCOUNTS_URL).host;

const Radio = ({ checked }: { readonly checked: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
      checked ? "border-focus" : "border-hairline-strong"
    )}
  >
    {checked ? <span className="bg-focus size-2 rounded-full" /> : null}
  </span>
);

const Choice = ({
  checked,
  onSelect,
  title,
  badge,
  children,
}: {
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly title: string;
  readonly badge?: string;
  readonly children: React.ReactNode;
}) => (
  <div
    role="radio"
    aria-checked={checked}
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        onSelect();
      }
    }}
    className="px-panel focus-visible:ring-focus flex cursor-default items-start gap-3 py-[calc(var(--spacing-gap)+4px)] outline-none focus-visible:ring-2"
  >
    <Radio checked={checked} />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="text-body text-text-default">{title}</span>
        {badge === undefined ? null : <Badge className="h-[18px] text-[11px]">{badge}</Badge>}
      </span>
      {children}
    </span>
  </div>
);

const DeviceCode = ({
  flow,
}: {
  readonly flow: Extract<AccountSignInView, { kind: "device" }>;
}) => {
  const now = useNow(1000);

  return (
    <div className="border-hairline bg-surface-sunken flex flex-col gap-2 border-t px-[calc(var(--spacing-panel)+4px)] py-[calc(var(--spacing-panel)+2px)]">
      <p className="text-caption text-text-subtle">
        Open the sign-in page on any browser signed in to GitHub, and check it shows this code.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <span
          data-testid="polaris-account-code"
          className="text-text-strong flex-1 font-mono text-[28px] leading-[34px] font-medium tracking-[0.06em] select-all"
        >
          {flow.userCode}
        </span>
        <CopyButton variant="button" label="Copy code" text={flow.userCode} />
        <Button
          variant="primary"
          disabled={flow.failure !== null}
          onClick={() =>
            void polaris().request("shell.openExternal", { url: flow.verificationUri })
          }
        >
          Open the sign-in page
          <ArrowUpRightIcon size={12} />
        </Button>
      </div>
      <p className="text-caption text-text-subtle tabular" role="status">
        {flow.failure ?? `Waiting for the browser · ${codeExpiry(flow.expiresAt, now)}`}
      </p>
    </div>
  );
};

const statusLine = (view: PolarisAccountsView, own: boolean) => {
  if (view.signIn?.kind === "browser")
    return "Waiting for GitHub in your browser. Come back here when it says you're signed in.";

  if (view.failure !== null) return `Couldn't sign in: ${view.failure.message}`;

  return own
    ? "For a team that runs its own account server. Invites reach only people on the same server."
    : null;
};

export const AddPolarisAccount = ({
  view,
  onClose,
}: {
  readonly view: PolarisAccountsView;
  readonly onClose: () => void;
}) => {
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState("");
  const server = own ? draft.trim() : undefined;
  const ready = !own || draft.trim() !== "";
  const busy = view.signIn !== null;
  const line = statusLine(view, own);

  const cancel = () => {
    void polaris().request("accounts.signIn.cancel", {});
    onClose();
  };

  const start = (method: "accounts.signIn.start" | "accounts.signIn.device") =>
    void polaris().request(method, server === undefined ? {} : { server });

  return (
    <SettingsCard
      title="Add account"
      aside="Account server"
      data-testid="add-polaris-account"
      status="GitHub accounts for pull requests stay in Settings → Review."
      action={
        <span className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!ready || busy}
            onClick={() => start("accounts.signIn.device")}
          >
            Use a code instead
          </Button>
          <Button
            size="xs"
            disabled={!ready || busy}
            onClick={() => start("accounts.signIn.start")}
          >
            Sign in with GitHub
          </Button>
        </span>
      }
    >
      <div
        role="radiogroup"
        aria-label="Account server"
        className="rounded-card bg-surface-sunken divide-hairline flex flex-col divide-y overflow-clip"
      >
        <Choice checked={!own} onSelect={() => setOwn(false)} title="Polaris Cloud" badge="Default">
          <span className="text-caption text-text-subtle font-mono">https://{CLOUD_HOST}</span>
        </Choice>
        <Choice checked={own} onSelect={() => setOwn(true)} title="Use your own server">
          {line === null ? null : <span className="text-caption text-text-subtle">{line}</span>}
          {own ? (
            <Input
              aria-label="Account server URL"
              placeholder="https://auth.example.com"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1.5 h-7 max-w-[360px] font-mono text-[12px]"
            />
          ) : null}
        </Choice>
        {view.signIn?.kind === "device" ? <DeviceCode flow={view.signIn} /> : null}
      </div>
      {!own && line !== null ? (
        <p className="text-caption text-text-subtle px-1 pt-2" role="status">
          {line}
        </p>
      ) : null}
    </SettingsCard>
  );
};
