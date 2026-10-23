/** What both entry points export; each adds the transports its runtime has. */
export {
  type ApprovalResponse,
  type DispatchError,
  type HostError,
  mergeHosts,
  type Polaris,
  type PolarisOptions,
  type StartSessionInput,
  type SubscribeSessionOptions,
} from "./client.ts";

export type { ConnectError, OpenTransport } from "./connection.ts";

export {
  CommandRejected,
  ExtensionTokenRejected,
  HostUnreachable,
  NotFound,
  NotGranted,
  ProtocolMismatch,
  UnknownHost,
} from "./errors.ts";

export type { HostView, Session, SessionEntry } from "./hostView.ts";

export type { HostEntry } from "./link.ts";

export {
  decodePairing,
  encodePairing,
  InvalidPairing,
  PAIRING_PREFIX,
  type ParsedPairing,
  parsePairing,
} from "./pairing.ts";

export { createPolarisWith, type PolarisClient } from "./promise.ts";

export type { SessionView, StreamingText, TurnEntry } from "./sessionView.ts";

export { webSocketTransport } from "./transport/websocket.ts";

export { SDK_VERSION, SUPPORTED_PROTOCOL } from "./version.ts";

export type {
  AgentSession,
  ApprovalRequest,
  GrantKind,
  HarnessKind,
  HostInfo,
  PermissionMode,
  SessionState,
  Turn,
  TurnItem,
  Workspace,
} from "@polaris/protocol";
