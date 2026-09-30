/**
 * Hosts one xterm instance: mounts it, fits it to the box, focuses it when
 * asked. The runtime (xterm and its WebGL renderer) loads on first use.
 */
import { useEffect, useRef } from "react";

export interface TerminalSurfaceProps {
  readonly hostKey: string;
  readonly terminalId: string;
  readonly autoFocus: boolean;
}

const runtime = () => import("../runtime.ts");

export const TerminalSurface = ({ hostKey, terminalId, autoFocus }: TerminalSurfaceProps) => {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;

    if (element === null) return undefined;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void runtime().then(({ fitTerminal, focusTerminal, mountTerminal }) => {
      if (cancelled) return;
      const unmount = mountTerminal(element, hostKey, terminalId);
      let frame = 0;

      // Fit once per frame at most while the drawer is dragged.
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => fitTerminal(hostKey, terminalId));
      });

      observer.observe(element);

      if (autoFocus) focusTerminal(hostKey, terminalId);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        unmount();
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [hostKey, terminalId, autoFocus]);

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-hidden py-1.5 pl-3"
      data-testid="terminal-surface"
      data-terminal-id={terminalId}
    />
  );
};
