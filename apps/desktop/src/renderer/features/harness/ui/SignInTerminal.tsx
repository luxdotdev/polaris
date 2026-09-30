/**
 * The sign-in hand-off (ADR 0001): a Harness's own sign-in runs in a Polaris
 * terminal on the Host; Polaris never sees a key. When it exits, availability
 * is probed again, so a signed-in Harness turns ready by itself.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polaris/ui";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { TerminalId } from "@polaris/protocol";
import { Predicate } from "effect";
import { polaris } from "../../bridge.ts";
import { refreshAvailability } from "../live.ts";
import { appendOutput, keyBytes, linksIn, tail } from "../model/terminal.ts";

export interface SignInTarget {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly harnessName: string;
  readonly argv: ReadonlyArray<string>;
  /** The terminal starts here: the Host's home directory. */
  readonly cwd: string;
}

type Phase =
  | { readonly kind: "opening" }
  | { readonly kind: "running"; readonly terminalId: TerminalId }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string };

const COLS = 100;

const ROWS = 30;

const encoder = new TextEncoder();

const useSignInTerminal = (target: SignInTarget) => {
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [output, setOutput] = useState("");

  useEffect(() => {
    let closed = false;
    let stop: (() => void) | null = null;
    let terminalId: TerminalId | null = null;
    const decoder = new TextDecoder();

    void polaris()
      .request("terminal.open", {
        hostKey: target.hostKey,
        cwd: target.cwd,
        cols: COLS,
        rows: ROWS,
        argv: [...target.argv],
      })
      .then((result) => {
        if (!result.ok) return setPhase({ kind: "failed", message: result.error.message });

        if (closed) {
          void polaris().request("terminal.close", { hostKey: target.hostKey, ...result.value });

          return undefined;
        }

        terminalId = result.value.terminalId;
        setPhase({ kind: "running", terminalId });
        stop = polaris().subscribe(
          "terminal",
          { hostKey: target.hostKey, terminalId },
          {
            items: (items) => {
              for (const item of items) {
                if (Predicate.isTagged(item, "Output")) {
                  const text = decoder.decode(item.data, { stream: true });

                  setOutput((shown) => tail(appendOutput(shown, text)));
                } else {
                  setPhase({ kind: "exited", code: item.code });
                  void refreshAvailability(target.hostKey);
                }
              }
            },
          }
        );

        return undefined;
      });

    return () => {
      closed = true;
      stop?.();

      if (terminalId !== null)
        void polaris().request("terminal.close", { hostKey: target.hostKey, terminalId });
    };
  }, [target]);

  const send = (data: string) => {
    if (phase.kind !== "running") return;
    void polaris().request("terminal.input", {
      hostKey: target.hostKey,
      terminalId: phase.terminalId,
      data: encoder.encode(data),
    });
  };

  return { phase, output, send };
};

const statusLine = (phase: Phase): string => {
  switch (phase.kind) {
    case "opening":
      return "Opening a terminal…";
    case "running":
      return "Running. Type here; the Harness reads it.";
    case "exited":
      return phase.code === 0 || phase.code === null
        ? "Finished. Checking the Harness again."
        : `Exited with ${phase.code}. Checking the Harness again.`;
    case "failed":
      return `Couldn't open a terminal: ${phase.message}`;
  }
};

const Screen = ({ target, onDone }: { target: SignInTarget; onDone: () => void }) => {
  const { phase, output, send } = useSignInTerminal(target);
  const screen = useRef<HTMLPreElement>(null);
  const links = linksIn(output);

  // The terminal is the dialog's one input: focus it, and follow its output.
  useEffect(() => {
    screen.current?.focus();
  }, []);

  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight });
  }, [output]);

  const onKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    const bytes = keyBytes(event);

    if (bytes === null) return;
    event.preventDefault();
    send(bytes);
  };

  return (
    <>
      <pre
        ref={screen}
        tabIndex={0}
        role="log"
        aria-label={`${target.harnessName} sign-in output`}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          send(event.clipboardData.getData("text"));
        }}
        className="rounded-control border-hairline bg-surface-sunken text-code-inline text-text-default h-72 overflow-auto border p-3 font-mono leading-[18px] break-all whitespace-pre-wrap"
        data-testid="sign-in-terminal"
      >
        {output}
      </pre>
      <p className="text-caption text-text-subtle" data-testid="sign-in-status">
        {statusLine(phase)}
      </p>
      {links.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          {links.slice(0, 3).map((link) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-text-default decoration-text-faint truncate underline underline-offset-4"
            >
              {link}
            </a>
          ))}
        </div>
      )}
      <DialogFooter>
        <Button variant={phase.kind === "exited" ? "primary" : "secondary"} onClick={onDone}>
          {phase.kind === "exited" ? "Done" : "Close"}
        </Button>
      </DialogFooter>
    </>
  );
};

export const SignInTerminal = ({
  target,
  onClose,
}: {
  readonly target: SignInTarget | null;
  readonly onClose: () => void;
}) => (
  <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
    <DialogContent className="w-[640px]">
      {target === null ? null : (
        <>
          <DialogHeader>
            <DialogTitle>
              Sign in to {target.harnessName} on {target.hostLabel}
            </DialogTitle>
            <DialogDescription>
              {target.harnessName}'s own sign-in runs here, in a terminal on the host. Polaris never
              sees your credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 pb-5">
            <Screen target={target} onDone={onClose} />
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);
