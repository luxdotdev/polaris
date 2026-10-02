/**
 * The Review Checkout menu (Paper R4 89C-0): what the state asks for (new commits, a blocker
 * and its fix, a clone), "Check out on" every Host with the repository, Run or Stop, a terminal
 * in the checkout, and a sunken footer with the worktree path and "Remove checkout".
 */
import { cn, PopoverContent, StopIcon, TerminalIcon } from "@polaris/ui";
import type { OpenPull } from "../../../../../shared/api.ts";
import { homePath } from "../../../../shell/copy.ts";
import { useShellActions } from "../../../../shell/hooks.ts";
import {
  checkOutOn,
  type Held,
  openTerminalIn,
  removeCheckout,
  startRunIn,
  stopRunIn,
} from "../actions.ts";
import { inSentence, shortSha } from "../model/chip.ts";
import type { HostChoice } from "../model/hosts.ts";
import { runningFact } from "../model/run.ts";
import type { RunCommand } from "../run.ts";
import type { CheckoutModel } from "../useCheckout.ts";
import { CheckGlyph, CodeGlyph, PlayGlyph } from "./glyphs.tsx";
import { Group, HOVER, ROW, RowGlyph } from "./menuParts.tsx";
import { Blocked, CloneOn, Fetching, NewCommits } from "./menuSections.tsx";
import { useOpenInEditor } from "../../../editor-links/index.ts";

type Nav = ReturnType<typeof useShellActions>;

interface MenuProps {
  readonly model: CheckoutModel;
  readonly pull: OpenPull;
  /** Open at a blocker's confirmation (the chip's action asked for it). */
  readonly asking?: boolean;
  readonly onDone: () => void;
}

const codeHostOf = (url: string | undefined) => {
  try {
    return url === undefined ? "github.com" : new URL(url).host;
  } catch {
    return "github.com";
  }
};

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
      choice.current ? "bg-fill-selected" : HOVER,
      !choice.enabled && "opacity-(--opacity-dimmed)"
    )}
  >
    <RowGlyph>
      {choice.current && (
        <span className="text-text-strong">
          <CheckGlyph />
        </span>
      )}
    </RowGlyph>
    <span
      className={cn(
        "text-body shrink-0",
        choice.current ? "text-text-strong font-medium" : "text-text-default"
      )}
    >
      {choice.label}
    </span>
    <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{choice.caption}</span>
    <span className="text-caption text-text-subtle shrink-0">{choice.trailing}</span>
  </button>
);

const Hosts = ({ model, pull, onDone }: MenuProps) => (
  <Group title="Check out on">
    {model.choices.map((choice) => (
      <HostRow
        key={choice.hostKey}
        choice={choice}
        onPick={() => {
          if (model.detail === null) return;
          void checkOutOn(choice, pull, model.detail);
          onDone();
        }}
      />
    ))}
  </Group>
);

const runCaption = (command: RunCommand) => {
  if (command.kind === "reading") return "reading package.json…";

  return command.kind === "found" ? command.command : "no dev or start script";
};

const MONO = "text-text-subtle min-w-0 flex-1 truncate font-mono text-[11px] leading-4";

const RunRow = ({ model, onDone }: Pick<MenuProps, "model" | "onDone">) => {
  const { held, view, command } = model;

  if (view.kind === "running" && held !== null) {
    return (
      <button
        type="button"
        data-testid="checkout-stop"
        className={cn(ROW, HOVER)}
        onClick={() => {
          void stopRunIn(held);
          onDone();
        }}
      >
        <RowGlyph>
          <StopIcon size={12} />
        </RowGlyph>
        <span className="text-body text-text-default shrink-0">Stop</span>
        <span className={MONO}>{runningFact(view.command, view.seconds)}</span>
      </button>
    );
  }

  const ready = held !== null && (view.kind === "ready" || view.kind === "new-commits");

  return (
    <button
      type="button"
      data-testid="checkout-run"
      disabled={!ready || command.kind !== "found"}
      className={cn(ROW, HOVER, "disabled:opacity-(--opacity-dimmed)")}
      onClick={() => {
        if (held === null || command.kind !== "found") return;
        void startRunIn(held, command.command);
        onDone();
      }}
    >
      <RowGlyph>
        <PlayGlyph />
      </RowGlyph>
      <span className="text-body text-text-default shrink-0">Run</span>
      <span className={MONO}>{runCaption(command)}</span>
    </button>
  );
};

const Actions = ({ model, pull, nav, onDone }: MenuProps & { readonly nav: Nav }) => {
  const { held } = model;
  const openEditor = useOpenInEditor();

  return (
    <Group title={null}>
      <RunRow model={model} onDone={onDone} />
      <button
        type="button"
        data-testid="checkout-terminal"
        disabled={held === null || held.checkout.head === null}
        onClick={() => {
          if (held === null) return;
          openTerminalIn(nav, held, pull);
          onDone();
        }}
        className={cn(ROW, HOVER, "disabled:opacity-(--opacity-dimmed)")}
      >
        <RowGlyph>
          <TerminalIcon size={14} />
        </RowGlyph>
        <span className="text-body text-text-default flex-1">Open a terminal in the checkout</span>
      </button>
      <button
        type="button"
        data-testid="checkout-editor"
        disabled={held === null || held.checkout.head === null}
        onClick={() => {
          if (held === null) return;
          openEditor({
            hostKey: held.hostKey,
            workspaceId: held.checkout.workspaceId,
            path: held.checkout.path,
            folder: true,
          });
          onDone();
        }}
        className={cn(ROW, HOVER, "disabled:opacity-(--opacity-dimmed)")}
      >
        <RowGlyph>
          <CodeGlyph />
        </RowGlyph>
        <span className="text-body text-text-default flex-1">Open in the editor</span>
      </button>
    </Group>
  );
};

const Footer = ({
  held,
  home,
  pull,
  onDone,
}: {
  readonly held: Held;
  readonly home: string | null;
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
        {homePath(held.checkout.path, home)}
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
    <p className="text-caption text-text-subtle">
      Removed on its own when #{pull.number} merges or closes.
    </p>
  </div>
);

const StateSection = ({ model, pull, nav, asking, onDone }: MenuProps & { readonly nav: Nav }) => {
  const { view, held, detail } = model;

  if (held === null) return null;

  if (view.kind === "new-commits") {
    return (
      <NewCommits
        held={held}
        compare={model.newCommits}
        branch={detail?.headRefName ?? null}
        onDone={onDone}
      />
    );
  }

  if (view.kind === "blocked") {
    return (
      <Blocked
        block={view.block}
        held={held}
        pull={pull}
        nav={nav}
        askFirst={asking === true}
        onDone={onDone}
      />
    );
  }

  if (view.kind === "checking-out")
    return <Fetching title={`Checking out on ${inSentence(view.host)}`} />;

  if (view.kind === "updating") return <Fetching title={`Updating to ${view.to}`} />;

  return null;
};

export const CheckoutMenu = (props: MenuProps) => {
  const nav = useShellActions();
  const { model, pull, onDone } = props;
  const { held, view } = model;
  const cloning = view.kind === "none" || view.kind === "clone-failed";

  return (
    <PopoverContent
      align="end"
      data-testid="checkout-menu"
      aria-label={
        held === null ? "Review checkout" : `Review checkout at ${shortSha(held.checkout.head)}`
      }
      className="flex w-[360px] flex-col overflow-clip p-0"
    >
      {cloning ? (
        <CloneOn
          pull={pull}
          targets={model.cloneTargets}
          codeHost={codeHostOf(model.detail?.url)}
          failed={view.kind === "clone-failed" ? { host: view.host, message: view.message } : null}
          onDone={onDone}
        />
      ) : (
        <>
          <StateSection {...props} nav={nav} />
          <Hosts {...props} />
          <Actions {...props} nav={nav} />
          {held !== null && <Footer held={held} home={model.home} pull={pull} onDone={onDone} />}
        </>
      )}
    </PopoverContent>
  );
};
