/**
 * A terminal inline in a page rather than in the drawer: Settings → Harnesses
 * runs a Harness's sign-in (`signInArgv`) under its host row. It opens on the
 * Host's home, reports the exit, and closes the Daemon terminal on unmount.
 */
import type { TerminalId } from "@polaris/protocol";
import { Button, IconButton, CloseIcon } from "@polaris/ui";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { loaded } from "../loaded.ts";
import { endedLine } from "../model/launch.ts";
import type { TabStatus } from "../model/tabs.ts";
import { onTerminalStatus } from "../store.ts";
import { TerminalSurface } from "./TerminalSurface.tsx";

export interface HarnessTerminalProps {
  readonly hostKey: string;
  readonly argv: ReadonlyArray<string>;
  readonly onExit: (code: number | null) => void;
  readonly onClose: () => void;
}

const INITIAL = { cols: 100, rows: 16 };

export const HarnessTerminal = ({ hostKey, argv, onExit, onClose }: HarnessTerminalProps) => {
  const homeDir = useApp((s) => s.hosts.find((h) => h.key === hostKey)?.status.host?.homeDir);
  const [terminalId, setTerminalId] = useState<TerminalId | null>(null);
  const [status, setStatus] = useState<TabStatus>({ kind: "opening" });
  const exited = useRef(onExit);
  const [run, setRun] = useState(0);
  const command = argv.join("\u0000");

  exited.current = onExit;

  useEffect(() => {
    if (homeDir === undefined) return undefined;
    let id: TerminalId | null = null;
    let off: () => void = () => undefined;
    let live = true;

    setStatus({ kind: "opening" });
    void polaris()
      .request("terminal.open", {
        hostKey,
        cwd: homeDir,
        argv: command.split("\u0000"),
        ...INITIAL,
      })
      .then((result) => {
        if (!live) {
          if (result.ok)
            void polaris().request("terminal.close", {
              hostKey,
              terminalId: result.value.terminalId,
            });

          return;
        }

        if (!result.ok) {
          setStatus({ kind: "failed", message: result.error.message });

          return;
        }

        id = result.value.terminalId;
        off = onTerminalStatus(id, (next) => {
          setStatus(next);

          if (next.kind === "exited") exited.current(next.code);
        });
        setTerminalId(id);
        setStatus({ kind: "live" });
      });

    return () => {
      live = false;
      off();

      if (id !== null) {
        loaded.runtime?.disposeTerminal(hostKey, id);
        void polaris().request("terminal.close", { hostKey, terminalId: id });
      }
    };
  }, [hostKey, homeDir, command, run]);

  const line = endedLine(status);

  return (
    <div
      className="border-hairline bg-bg rounded-row flex h-72 flex-col overflow-hidden border"
      data-testid="harness-terminal"
    >
      <div className="border-hairline flex h-8 shrink-0 items-center gap-2 border-b pr-1 pl-3">
        <span className="text-code-inline text-text-subtle min-w-0 flex-1 truncate font-mono">
          {argv.join(" ")}
        </span>
        <IconButton size="sm" label="Close" icon={<CloseIcon size={12} />} onClick={onClose} />
      </div>
      {terminalId === null ? (
        <div className="flex-1" />
      ) : (
        <TerminalSurface key={terminalId} hostKey={hostKey} terminalId={terminalId} autoFocus />
      )}
      {line === null ? null : (
        <div className="border-hairline bg-surface-sunken flex h-9 shrink-0 items-center gap-3 border-t px-3">
          <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{line}</span>
          <Button size="sm" onClick={() => setRun((n) => n + 1)}>
            Run again
          </Button>
        </div>
      )}
    </div>
  );
};
