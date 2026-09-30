/**
 * The terminal feature: a drawer of Daemon terminals per Workspace (xterm.js
 * on WebGL, fed by the `terminal` feed), and the "Open in terminal" hand-off.
 * The shell wraps a pane in `TerminalDock`; other features run commands in it.
 */
export { TerminalDock, type TerminalDockProps } from "./ui/TerminalDock.tsx";

export { InTerminalBar, OpenInTerminalItem, type HandoffSession } from "./ui/InTerminal.tsx";

export { keepTerminalFocus } from "./focus.ts";

export { runInTerminal, toggleTerminal, type TerminalPlace, type TerminalRun } from "./actions.ts";

export { HarnessTerminal, type HarnessTerminalProps } from "./ui/HarnessTerminal.tsx";
