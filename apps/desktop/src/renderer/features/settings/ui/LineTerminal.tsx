/**
 * A Harness's own command in a Polaris terminal on its Host, line by line:
 * output as plain text (escape sequences dropped), one input line sent with
 * Enter. The `HarnessTerminal` slot's default until the terminal feature's
 * emulator replaces it; enough for a sign-in's URL, code and prompts.
 */
import type { TerminalId } from "@polaris/protocol";
import { Button, Input } from "@polaris/ui";
import { Match } from "effect";
import { useEffect, useRef, useState } from "react";
import type { HarnessTerminalProps } from "../../../app/slots.tsx";
import { useApp } from "../../../shell/hooks.ts";
import { plainText } from "../model/terminalText.ts";

/** Raw output kept; the text shown is derived from it, so a split escape resolves. */
const MAX_RAW = 40_000;

const encoder = new TextEncoder();

type Phase =
  | { readonly kind: "opening" }
  | { readonly kind: "running"; readonly terminalId: TerminalId }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string };

const useTerminal = ({ hostKey, argv, onExit }: HarnessTerminalProps) => {
  const home = useApp((s) => s.hosts.find((h) => h.key === hostKey)?.status.host?.homeDir ?? "/");
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [raw, setRaw] = useState("");
  const exitRef = useRef(onExit);
  const command = argv.join("\u0000");

  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const api = window.polaris;
    const decoder = new TextDecoder();
    let live = true;
    let unsubscribe: (() => void) | null = null;
    let opened: TerminalId | null = null;

    void api
      .request("terminal.open", {
        hostKey,
        cwd: home,
        cols: 100,
        rows: 30,
        argv: command.split("\u0000"),
      })
      .then((result) => {
        if (!live) {
          if (result.ok) {
            void api.request("terminal.close", { hostKey, terminalId: result.value.terminalId });
          }

          return;
        }

        if (!result.ok) {
          setPhase({ kind: "failed", message: result.error.message });

          return;
        }

        opened = result.value.terminalId;

        setPhase({ kind: "running", terminalId: opened });
        unsubscribe = api.subscribe(
          "terminal",
          { hostKey, terminalId: opened },
          {
            items: (items) => {
              for (const item of items) {
                Match.value(item).pipe(
                  Match.tagsExhaustive({
                    Output: ({ data }) => {
                      const chunk = decoder.decode(data, { stream: true });

                      setRaw((r) => (r + chunk).slice(-MAX_RAW));
                    },
                    Exit: ({ code }) => {
                      opened = null;
                      setPhase({ kind: "exited", code });
                      exitRef.current(code);
                    },
                  })
                );
              }
            },
          }
        );
      });

    return () => {
      live = false;
      unsubscribe?.();

      if (opened !== null) void api.request("terminal.close", { hostKey, terminalId: opened });
    };
  }, [hostKey, home, command]);

  const send = (line: string) => {
    if (phase.kind !== "running") return;
    void window.polaris.request("terminal.input", {
      hostKey,
      terminalId: phase.terminalId,
      data: encoder.encode(`${line}\r`),
    });
  };

  return { phase, text: plainText(raw), send };
};

const status = (phase: Phase): string => {
  switch (phase.kind) {
    case "opening":
      return "Opening a terminal…";
    case "running":
      return "Running";
    case "exited":
      return phase.code === 0 || phase.code === null ? "Finished" : `Exited with ${phase.code}`;
    case "failed":
      return `Couldn't open a terminal: ${phase.message}`;
  }
};

export const LineTerminal = (props: HarnessTerminalProps) => {
  const { phase, text, send } = useTerminal(props);
  const [line, setLine] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = outputRef.current;

    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      className="bg-surface-sunken px-panel flex flex-col gap-2 py-3"
      data-testid="sign-in-terminal"
    >
      <div className="flex items-center gap-2">
        <span className="text-caption text-text-subtle font-mono">{props.argv.join(" ")}</span>
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">{status(phase)}</span>
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          Close
        </Button>
      </div>
      <pre
        ref={outputRef}
        className="text-code-inline text-text-default rounded-control border-hairline bg-bg h-40 overflow-y-auto border p-2 font-mono break-all whitespace-pre-wrap"
      >
        {text}
      </pre>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(line);
          setLine("");
        }}
      >
        <Input
          aria-label="Terminal input"
          className="font-mono"
          placeholder="Type and press Enter"
          value={line}
          disabled={phase.kind !== "running"}
          onChange={(event) => setLine(event.target.value)}
        />
      </form>
    </div>
  );
};
