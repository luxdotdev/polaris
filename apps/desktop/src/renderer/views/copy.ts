/** UI copy for states: glossary terms, lowercase (DESIGN.md rule/glossary-lowercase). */
import type { ConnectionState, SessionState } from "@polaris/protocol";

export const connectionLabel: Readonly<Record<ConnectionState, string>> = {
  connected: "connected",
  reconnecting: "reconnecting",
  "needs-attention": "needs attention",
  offline: "offline",
};

export const sessionStateLabel: Readonly<Record<SessionState, string>> = {
  starting: "starting",
  working: "working",
  "needs-you": "needs you",
  idle: "idle",
  "in-terminal": "in terminal",
  dormant: "dormant",
  failed: "failed",
  archived: "archived",
};
