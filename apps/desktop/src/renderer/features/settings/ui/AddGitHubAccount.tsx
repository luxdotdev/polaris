/**
 * Adding a GitHub account (Paper S6): the device flow's one-time code, copy and "Open
 * github.com/login/device", and the wait. Polaris never sees a password; the code and
 * its state come on `github.accounts`.
 */
import { ArrowUpRightIcon, Button } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { SignInView } from "../../../../shared/github.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { signInStatus } from "../model/github.ts";

/** A quarter arc on a faint ring, still: only the Working dither loops (DESIGN.md, Motion). */
const WaitGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-text-subtle shrink-0">
    <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--color-hairline)" strokeWidth="1.5" />
    <path
      d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const CopyButton = ({ code }: { readonly code: string }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [code]);

  return (
    <Button
      onClick={() => {
        void polaris()
          .request("clipboard.write", { text: code })
          .then((result) => setCopied(result.ok));
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
};

const hostOf = (uri: string) => uri.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const AddGitHubAccount = ({ flow }: { readonly flow: SignInView }) => {
  const now = useNow(1000);
  const status = signInStatus(flow, now);

  return (
    <section
      aria-label="Add a GitHub account"
      data-testid="github-sign-in"
      className="rounded-card border-hairline flex flex-col overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)] shadow-[0_4px_16px_light-dark(#0000000f,#00000040)]"
    >
      <div className="pt-panel flex items-center gap-3 px-[calc(var(--spacing-panel)+4px)] pb-1">
        <h2 className="text-heading-sm text-text-strong flex-1 font-medium">
          Add a GitHub account
        </h2>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void polaris().request("github.signIn.cancel", {})}
        >
          Cancel
        </Button>
      </div>
      <p className="text-body text-text-subtle pb-panel px-[calc(var(--spacing-panel)+4px)]">
        Sign in on {flow.host ?? "github.com"} as the account you want to add, then enter this code.
      </p>
      <div className="border-hairline bg-surface-sunken flex flex-wrap items-center gap-4 border-y px-[calc(var(--spacing-panel)+4px)] py-[calc(var(--spacing-panel)+2px)]">
        <span
          data-testid="github-user-code"
          className="text-text-strong flex-1 font-mono text-[28px] leading-[34px] font-medium tracking-[0.06em] select-all"
        >
          {flow.userCode}
        </span>
        <CopyButton code={flow.userCode} />
        <Button
          variant="primary"
          disabled={!status.waiting}
          onClick={() =>
            void polaris().request("shell.openExternal", { url: flow.verificationUri })
          }
        >
          Open {hostOf(flow.verificationUri)}
          <ArrowUpRightIcon size={12} />
        </Button>
      </div>
      <div
        className="flex items-center gap-2.5 px-[calc(var(--spacing-panel)+4px)] py-[calc(var(--spacing-gap)+4px)]"
        role="status"
      >
        {status.waiting ? <WaitGlyph /> : null}
        <span className="text-caption text-text-default flex-1">{status.text}</span>
        {status.aside === null ? (
          <Button
            size="xs"
            onClick={() =>
              void polaris().request(
                "github.signIn.start",
                flow.host === undefined ? {} : { host: flow.host }
              )
            }
          >
            Get a new code
          </Button>
        ) : (
          <span className="text-caption text-text-subtle tabular">{status.aside}</span>
        )}
      </div>
    </section>
  );
};
