/**
 * Every Harness on a Host, with what it needs (DESIGN.md, Settings S1): version,
 * status in neutral words, the setup line, and at most one action (sign in in
 * its own terminal, or its setup guide). Polaris never installs a Harness.
 * Opened from the pickers' "Other harnesses" link until Settings hosts it.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  HarnessMark,
} from "@polaris/ui";
import { useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { useAvailability } from "../live.ts";
import { type HarnessOption, otherCount, reasonLine, STATUS_LABELS } from "../model/options.ts";
import { SignInTerminal, type SignInTarget } from "./SignInTerminal.tsx";

/** Starts a Harness's sign-in hand-off on a Host; render `dialog` once. */
export const useSignIn = (hostKey: string) => {
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const [target, setTarget] = useState<SignInTarget | null>(null);

  const begin = (option: HarnessOption) => {
    if (option.signInArgv === null) return;
    setTarget({
      hostKey,
      hostLabel: host?.label ?? hostKey,
      harnessName: option.name,
      argv: option.signInArgv,
    });
  };

  return { begin, dialog: <SignInTerminal target={target} onClose={() => setTarget(null)} /> };
};

export const DocsLink = ({ option }: { readonly option: HarnessOption }) =>
  option.docsUrl === null ? null : (
    <a
      href={option.docsUrl}
      target="_blank"
      rel="noreferrer"
      className="text-label text-text-strong decoration-text-faint shrink-0 underline underline-offset-4"
    >
      Setup guide
    </a>
  );

/** One Harness's action: sign in when that's all it needs, else its setup guide; none when ready. */
export const HarnessAction = ({
  option,
  onSignIn,
}: {
  readonly option: HarnessOption;
  readonly onSignIn: (option: HarnessOption) => void;
}) => {
  if (option.status === "ready") return null;

  if (option.signInArgv !== null)
    return (
      <Button size="sm" onClick={() => onSignIn(option)} data-testid={`sign-in-${option.kind}`}>
        Sign in in terminal
      </Button>
    );

  return <DocsLink option={option} />;
};

const Row = ({
  option,
  onSignIn,
}: {
  readonly option: HarnessOption;
  readonly onSignIn: (option: HarnessOption) => void;
}) => (
  <li
    className="border-hairline flex flex-col gap-1 border-t px-4 py-3 first:border-t-0"
    data-testid={`availability-${option.kind}`}
    data-status={option.status}
  >
    <div className="flex items-center gap-3">
      <HarnessMark harness={option.kind} size={28} />
      <span className="text-label text-text-strong min-w-0 flex-1 truncate">{option.name}</span>
      <span className="text-code-inline text-text-subtle w-24 shrink-0 truncate font-mono">
        {option.version ?? ""}
      </span>
      <span className="text-caption text-text-subtle w-36 shrink-0">
        {STATUS_LABELS[option.status]}
      </span>
      <span className="flex w-36 shrink-0 justify-end">
        <HarnessAction option={option} onSignIn={onSignIn} />
      </span>
    </div>
    {option.setupLine === null && option.detail === null ? null : (
      <p className="text-caption text-text-subtle pl-10">
        {[option.setupLine, option.detail].filter((t) => t !== null).join(" ")}
      </p>
    )}
  </li>
);

export const AvailabilityList = ({ hostKey }: { readonly hostKey: string }) => {
  const { options, loading, refresh } = useAvailability(hostKey);
  const signIn = useSignIn(hostKey);

  return (
    <div className="flex flex-col gap-3">
      {loading ? <p className="text-caption text-text-faint">Checking harnesses…</p> : null}
      <ul className="rounded-card border-hairline flex flex-col border">
        {options.map((option) => (
          <Row key={option.kind} option={option} onSignIn={signIn.begin} />
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <p className="text-caption text-text-faint flex-1">
          Polaris drives the harnesses you already have; it never installs one.
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} data-testid="availability-refresh">
          Check again
        </Button>
      </div>
      {signIn.dialog}
    </div>
  );
};

/** The Host's availability in a sheet: what the pickers' "Other harnesses" opens. */
export const AvailabilitySheet = ({
  hostKey,
  open,
  onOpenChange,
}: {
  readonly hostKey: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => {
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[680px]" data-testid="availability-sheet">
        <DialogHeader>
          <DialogTitle>Harnesses on {host?.label ?? hostKey}</DialogTitle>
          <DialogDescription>
            What each harness needs before a session can run on it here.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-5">
          <AvailabilityList hostKey={hostKey} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** "Other harnesses (3)": the ones the pickers leave out, in the availability sheet. */
export const OtherHarnessesLink = ({
  hostKey,
  options,
}: {
  readonly hostKey: string;
  readonly options: ReadonlyArray<HarnessOption>;
}) => {
  const [open, setOpen] = useState(false);
  const others = otherCount(options);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-caption text-text-default decoration-text-faint cursor-default self-start underline underline-offset-4"
        data-testid="other-harnesses"
      >
        {others === 0 ? "Harnesses on this host" : `Other harnesses (${others})`}
      </button>
      <AvailabilitySheet hostKey={hostKey} open={open} onOpenChange={setOpen} />
    </>
  );
};

/** Under a chosen Harness that can't start yet: its setup line, and sign-in or its docs. */
export const SetupNote = ({
  option,
  onSignIn,
}: {
  readonly option: HarnessOption;
  readonly onSignIn: (option: HarnessOption) => void;
}) => (
  <div
    className="rounded-card border-hairline bg-surface-raised flex items-center gap-3 border px-4 py-3"
    data-testid="harness-setup"
  >
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <p className="text-body text-text-default">
        {option.setupLine ?? `${option.name} can't start yet.`}
      </p>
      {option.detail === null ? null : (
        <p className="text-caption text-text-subtle">{option.detail}</p>
      )}
    </div>
    <HarnessAction option={option} onSignIn={onSignIn} />
  </div>
);

/**
 * When no Harness on the Host is ready: each one's reason in a line, its setup guide, and
 * sign-in where that's all it needs. Never an install or update action; Start stays off.
 */
export const NotReadyPanel = ({
  hostKey,
  options,
  onSignIn,
}: {
  readonly hostKey: string;
  readonly options: ReadonlyArray<HarnessOption>;
  readonly onSignIn: (option: HarnessOption) => void;
}) => {
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const { refresh } = useAvailability(hostKey);

  return (
    <div
      className="rounded-card border-hairline bg-surface-raised flex flex-col border"
      data-testid="harness-not-ready"
    >
      <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
        <p className="text-label text-text-strong">
          No harness is ready on {host?.label ?? hostKey}
        </p>
        <p className="text-caption text-text-subtle">
          Polaris drives the harnesses you already have. Set one up, then check again.
        </p>
      </div>
      <ul className="flex flex-col">
        {options.map((option) => (
          <li
            key={option.kind}
            className="border-hairline flex items-center gap-3 border-t px-4 py-2"
            data-testid={`not-ready-${option.kind}`}
          >
            <HarnessMark harness={option.kind} size={20} />
            <span className="text-body text-text-default min-w-0 flex-1 truncate">
              {reasonLine(option)}
            </span>
            {option.signInArgv === null ? (
              <DocsLink option={option} />
            ) : (
              <HarnessAction option={option} onSignIn={onSignIn} />
            )}
          </li>
        ))}
      </ul>
      <div className="border-hairline flex justify-end border-t px-2 py-1.5">
        <Button variant="ghost" size="sm" onClick={refresh} data-testid="availability-refresh">
          Check again
        </Button>
      </div>
    </div>
  );
};
