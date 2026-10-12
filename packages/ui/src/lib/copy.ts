/**
 * Copying text with feedback (DESIGN.md, Copy button). The writer comes from
 * `CopyProvider`: the Desktop App writes through its main process, since the
 * renderer has no clipboard permission; elsewhere `navigator.clipboard`.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type CopyState = "idle" | "copied" | "failed";

/** Resolves true when the text reached the clipboard. */
export type CopyWrite = (text: string) => Promise<boolean>;

const browserWrite: CopyWrite = async (text) => {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
};

const CopyContext = createContext<CopyWrite>(browserWrite);

export function CopyProvider({
  write,
  children,
}: {
  readonly write: CopyWrite;
  readonly children: ReactNode;
}) {
  return createElement(CopyContext.Provider, { value: write }, children);
}

/** The writer in scope, for copies with no button of their own (a menu item). */
export const useCopyWrite = () => useContext(CopyContext);

/**
 * `copy` writes and shows "copied" or "failed" for `resetMs`, then "idle". A new copy
 * restarts the wait, and nothing fires after unmount.
 */
export function useCopy(write?: CopyWrite, { resetMs = 1500 }: { resetMs?: number } = {}) {
  const fallback = useContext(CopyContext);
  const writer = write ?? fallback;
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;

      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const copy = (text: string) => {
    const attempt = ++latest.current;

    void writer(text)
      .catch(() => false)
      .then((ok) => {
        // Only the newest copy speaks, and never after unmount.
        if (!mounted.current || attempt !== latest.current) return;

        if (timer.current !== null) clearTimeout(timer.current);
        setState(ok ? "copied" : "failed");
        timer.current = setTimeout(() => {
          timer.current = null;
          setState("idle");
        }, resetMs);
      });
  };

  return { state, copy };
}
