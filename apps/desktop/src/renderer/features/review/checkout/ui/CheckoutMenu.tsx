/**
 * The Review Checkout menu (Paper R4 89C-0): what the state asks for (new commits, a blocker
 * and its fix), "Check out on" every Host with the repository, a terminal in the checkout,
 * and a sunken footer with the worktree path and "Remove checkout".
 */
import { Button, cn, PopoverContent, TerminalIcon } from "@polaris/ui";
import { type ReactNode, useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { useShellActions } from "../../../../shell/hooks.ts";
import {
  checkOutOn,
  type Held,
  openTerminalIn,
  removeCheckout,
  runFix,
  updateCheckout,
} from "../actions.ts";
import { type BlockView, shortSha } from "../model/chip.ts";
import type { HostChoice } from "../model/hosts.ts";
import type { CheckoutModel } from "../useCheckout.ts";
import { CheckGlyph, CodeGlyph } from "./glyphs.tsx";

type Nav = ReturnType<typeof useShellActions>;

interface MenuProps {
  readonly model: CheckoutModel;
  readonly pull: OpenPull;
  readonly onDone: () => void;
}

const Section = ({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) => (
  <div data-testid={testId} className="gap-row-x flex flex-col p-3.5">
    {children}
  </div>
);

const Heading = ({ title, fact }: { readonly title: string; readonly fact: string }) => (
  <div className="flex flex-col gap-0.5">
    <p className="text-body text-text-strong font-medium">{title}</p>
    <p className="text-caption text-text-subtle">{fact}</p>
  </div>
);

const Well = ({ lines }: { readonly lines: ReadonlyArray<string> }) => (
  <div className="bg-surface-sunken px-row-x py-gap flex flex-col gap-1 rounded-[8px]">
    {lines.map((line) => (
      <p key={line} className="text-text-default font-mono text-[11px] leading-4 break-all">
        {line}
      </p>
    ))}
  </div>
);

const Primary = ({
  label,
  onClick,
  testId,
  after,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
  readonly after: string | null;
}) => (
  <div className="gap-row-x flex items-center">
    <Button size="sm" variant="primary" data-testid={testId} onClick={onClick} className="shrink-0">
      {label}
    </Button>
    {after !== null && <p className="text-caption text-text-faint">{after}</p>}
  </div>
);

const NewCommits = ({
  held,
  at,
  latest,
  branch,
  onDone,
}: {
  readonly held: Held;
  readonly at: string;
  readonly latest: string;
  readonly branch: string | null;
  readonly onDone: () => void;
}) => (
  <Section testId="checkout-menu-new-commits">
    <Heading
      title={branch === null ? "New commits" : `New commits on ${branch}`}
      fact={`Your checkout on ${held.hostLabel} is at ${at}; the pull request is at ${latest}`}
    />
    <Primary
      testId="checkout-update"
      label="Update checkout"
      after="then rerun the risk summary on the new commits only"
      onClick={() => {
        void updateCheckout(held);
        onDone();
      }}
    />
  </Section>
);

const Blocked = ({
  block,
  held,
  pull,
  nav,
  onDone,
}: {
  readonly block: BlockView;
  readonly held: Held;
  readonly pull: OpenPull;
  readonly nav: Nav;
  readonly onDone: () => void;
}) => {
  const [asking, setAsking] = useState(false);

  const fix = () => {
    runFix(block.fix, held, pull, nav);
    onDone();
  };

  return (
    <Section testId="checkout-menu-blocked">
      <Heading title={block.title} fact={block.fact} />
      {block.evidence.length > 0 && <Well lines={block.evidence} />}
      {asking && block.confirm !== null ? (
        <div className="gap-row-x flex items-center">
          <Button size="sm" variant="danger" data-testid="checkout-fix-confirm" onClick={fix}>
            {block.confirm.replace(/\?$/, "")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Keep them
          </Button>
        </div>
      ) : (
        <Primary
          testId="checkout-fix"
          label={block.fix.label}
          after={null}
          onClick={() => (block.confirm === null ? fix() : setAsking(true))}
        />
      )}
    </Section>
  );
};

const ROW =
  "px-gap gap-row-x flex h-[30px] w-full shrink-0 items-center rounded-control text-left outline-hidden";

const HostRow = ({
  choice,
  onPick,
}: {
  readonly choice: HostChoice;
  readonly onPick: () => void;
}) => (
  <button
    type="button"
    data-testid="checkout-host"
    data-host={choice.hostKey}
    disabled={!choice.enabled || choice.current}
    aria-current={choice.current ? "true" : undefined}
    onClick={onPick}
    className={cn(
      ROW,
      choice.current ? "bg-fill-selected" : "hover:bg-fill-hover focus-visible:bg-fill-hover",
      !choice.enabled && "opacity-(--opacity-dimmed)"
    )}
  >
    <span className="text-text-strong w-panel flex shrink-0 justify-center">
      {choice.current && <CheckGlyph />}
    </span>
    <span
      className={cn(
        "text-body shrink-0",
        choice.current ? "text-text-strong font-medium" : "text-text-default"
      )}
    >
      {choice.label}
    </span>
    <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{choice.caption}</span>
    <span className="text-caption text-text-faint shrink-0">{choice.trailing}</span>
  </button>
);

const Hosts = ({ model, pull, onDone }: MenuProps) => {
  const { choices, detail } = model;

  return (
    <div className="border-hairline pt-row-x pb-gap flex flex-col gap-0.5 border-t px-1.5 first:border-t-0">
      <p className="text-caption text-text-faint px-gap pt-0.5 pb-1.5">Check out on</p>
      {choices.length === 0 ? (
        <p className="text-caption text-text-subtle px-gap pb-1">
          No workspace has this repo. Open a folder with it on a host to check it out there.
        </p>
      ) : (
        choices.map((choice) => (
          <HostRow
            key={choice.hostKey}
            choice={choice}
            onPick={() => {
              if (detail === null) return;
              void checkOutOn(choice, pull, detail);
              onDone();
            }}
          />
        ))
      )}
    </div>
  );
};

const Actions = ({
  held,
  pull,
  nav,
  onDone,
}: {
  readonly held: Held | null;
  readonly pull: OpenPull;
  readonly nav: Nav;
  readonly onDone: () => void;
}) => (
  <div className="border-hairline flex flex-col gap-0.5 border-t p-1.5">
    <button
      type="button"
      data-testid="checkout-terminal"
      disabled={held === null || held.checkout.head === null}
      onClick={() => {
        if (held === null) return;
        openTerminalIn(nav, held, pull);
        onDone();
      }}
      className={cn(
        ROW,
        "hover:bg-fill-hover focus-visible:bg-fill-hover disabled:opacity-(--opacity-dimmed)"
      )}
    >
      <span className="text-text-subtle w-panel flex shrink-0 justify-center">
        <TerminalIcon size={14} />
      </span>
      <span className="text-body text-text-default flex-1">Open a terminal in the checkout</span>
    </button>
    <div aria-disabled="true" className={cn(ROW, "opacity-(--opacity-dimmed)")}>
      <span className="text-text-subtle w-panel flex shrink-0 justify-center">
        <CodeGlyph />
      </span>
      <span className="text-body text-text-default flex-1">Open in the editor</span>
      <span className="text-caption text-text-faint shrink-0">with the editor, later</span>
    </div>
  </div>
);

const Footer = ({
  held,
  pull,
  onDone,
}: {
  readonly held: Held;
  readonly pull: OpenPull;
  readonly onDone: () => void;
}) => (
  <div className="bg-surface-sunken border-hairline py-row-x flex flex-col gap-1 border-t px-3.5">
    <div className="gap-gap flex items-center">
      <p
        data-testid="checkout-path"
        title={held.checkout.path}
        className="text-text-subtle min-w-0 flex-1 truncate font-mono text-[11px] leading-4"
      >
        {held.checkout.path}
      </p>
      <button
        type="button"
        data-testid="checkout-remove"
        disabled={held.checkout.state === "removing"}
        className="text-caption text-text-default hover:text-text-strong shrink-0 font-medium disabled:opacity-(--opacity-dimmed)"
        onClick={() => {
          void removeCheckout(held, pull, "user");
          onDone();
        }}
      >
        Remove checkout
      </button>
    </div>
    <p className="text-caption text-text-faint">
      Removed on its own when #{pull.number} merges or closes.
    </p>
  </div>
);

const StateSection = ({ model, pull, nav, onDone }: MenuProps & { readonly nav: Nav }) => {
  const { view, held, detail } = model;

  if (held === null) return null;

  if (view.kind === "new-commits") {
    return (
      <NewCommits
        held={held}
        at={view.at}
        latest={view.latest}
        branch={detail?.headRefName ?? null}
        onDone={onDone}
      />
    );
  }

  if (view.kind === "blocked") {
    return <Blocked block={view.block} held={held} pull={pull} nav={nav} onDone={onDone} />;
  }

  if (view.kind === "checking-out" || view.kind === "updating") {
    return (
      <Section testId="checkout-menu-fetching">
        <Heading
          title={
            view.kind === "updating" ? `Updating to ${view.to}` : `Checking out on ${view.host}`
          }
          fact="Fetches use the host’s own git credentials, not your GitHub sign-in in Polaris."
        />
      </Section>
    );
  }

  return null;
};

export const CheckoutMenu = (props: MenuProps) => {
  const nav = useShellActions();
  const { held } = props.model;
  const at = held === null ? "" : shortSha(held.checkout.head);

  return (
    <PopoverContent
      align="end"
      data-testid="checkout-menu"
      aria-label={held === null ? "Review checkout" : `Review checkout at ${at}`}
      className="flex w-[360px] flex-col overflow-clip p-0"
    >
      <StateSection {...props} nav={nav} />
      <Hosts {...props} />
      <Actions held={held} pull={props.pull} nav={nav} onDone={props.onDone} />
      {held !== null && <Footer held={held} pull={props.pull} onDone={props.onDone} />}
    </PopoverContent>
  );
};
