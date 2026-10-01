/** One neutral notice above the list (Paper R3): never a signal colour. */
import type { ReactNode } from "react";
import { polaris } from "../../bridge.ts";
import type { Notice } from "../model/notices.ts";
import { dismissNotice } from "../store.ts";
import { PersonGlyph } from "./glyphs.tsx";

const Action = ({
  primary = false,
  onClick,
  children,
}: {
  readonly primary?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={
      primary
        ? "rounded-control bg-fill-selected text-caption text-text-strong hover:bg-fill-selected/70 h-(--spacing-tree-row) shrink-0 cursor-default px-2.5 font-medium"
        : "text-caption text-text-faint hover:text-text-subtle h-(--spacing-tree-row) shrink-0 cursor-default px-2"
    }
  >
    {children}
  </button>
);

const openUrl = (url: string) => void polaris().request("shell.openExternal", { url });

const repoRef = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");

  return { owner, name };
};

export interface NoticeRowProps {
  readonly notice: Notice;
  /** Settings → GitHub accounts, to add the account that sees it. */
  readonly onAddAccount: () => void;
}

const actionsOf = ({ notice, onAddAccount }: NoticeRowProps): ReactNode => {
  if (notice.kind === "error") {
    return (
      <Action primary onClick={() => void polaris().request("github.refresh", {})}>
        Try again
      </Action>
    );
  }

  if (notice.kind === "no-account") {
    return (
      <>
        <Action primary onClick={onAddAccount}>
          Add account
        </Action>
        <Action onClick={() => dismissNotice(notice.key)}>Not now</Action>
      </>
    );
  }

  const { approvalUrl, ssoUrl } = notice;

  return (
    <>
      {approvalUrl === null ? null : (
        <Action primary onClick={() => openUrl(approvalUrl)}>
          Request access
        </Action>
      )}
      {ssoUrl === null ? null : <Action onClick={() => openUrl(ssoUrl)}>Sign in with SSO</Action>}
      <Action
        onClick={() => void polaris().request("github.recheck", { repo: repoRef(notice.repo) })}
      >
        Check again
      </Action>
      <Action onClick={() => dismissNotice(notice.key)}>Not now</Action>
    </>
  );
};

export const NoticeRow = (props: NoticeRowProps) => (
  <div
    data-testid="pulls-notice"
    data-kind={props.notice.kind}
    className="rounded-row border-hairline bg-surface-raised flex min-h-11 shrink-0 items-center gap-3 border py-1.5 pr-2 pl-3.5"
  >
    <span className="text-text-subtle">
      <PersonGlyph />
    </span>
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="text-body text-text-default shrink-0 font-medium">{props.notice.title}</span>
      <span className="text-caption text-text-subtle truncate">{props.notice.caption}</span>
    </span>
    {actionsOf(props)}
  </div>
);
