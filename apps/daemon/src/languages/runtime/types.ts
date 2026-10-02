import type {
  HostId,
  LanguageContextIdentity,
  LanguageCheckout,
  LanguageProviderCapabilities,
  LanguageRuntime,
  LanguageRequestFence,
} from "@polaris/protocol";
import type { DiscoveryFacts, DiscoveryInput } from "../discovery/index.ts";
import type { CanonicalCheckout } from "../trust/index.ts";
import type { OrderedConnection, ProcessPort } from "../transport/index.ts";
import type { ContextEvents } from "./events.ts";
import type { Documents } from "./documents.ts";
import type { ServerBridge } from "./server.ts";
import type { lifecycleInitial, LifecycleEvent } from "./lifecycle.ts";
import type { Launch } from "./process.ts";

export interface AcquireInput extends DiscoveryInput {
  clientId: string;
  contextId: string;
  interestId: string;
}

export interface BrokerOptions {
  hostId: HostId;
  discover: (input: DiscoveryInput) => Promise<DiscoveryFacts>;
  invalidateDiscovery: () => void;
  requireTrust: (checkout: LanguageCheckout) => Promise<CanonicalCheckout>;
  /** Resolve installed/version/prerequisite facts or fail with a distinct LanguageError. Never install here. */
  resolveLaunch: (facts: DiscoveryFacts) => Promise<Launch>;
  spawn?: (launch: Launch) => ProcessPort;
  prepareEdit?: ConstructorParameters<typeof ServerBridge>[0]["prepareEdit"];
  observeLifecycle?: ((record: { event: LifecycleEvent; phase: string }) => void) | undefined;
  graceMs?: number;
  retryMs?: number;
}

export interface Entry {
  input: AcquireInput;
  facts: DiscoveryFacts;
  identity: LanguageContextIdentity;
  documents: Documents;
  interests: Set<string>;
  events: ContextEvents;
  lifecycle: ReturnType<typeof lifecycleInitial>;
  runtime: typeof LanguageRuntime.Type;
  capabilities?: LanguageProviderCapabilities | undefined;
  connection?: OrderedConnection | undefined;
  stderrAbort?: AbortController | undefined;
  bridge?: ServerBridge | undefined;
  starting?: Promise<void> | undefined;
  timer?: ReturnType<typeof setTimeout> | undefined;
  attempts: number;
  operations: Map<string, { id: number; fence: LanguageRequestFence }>;
  tail: Promise<void>;
  queued: number;
}
