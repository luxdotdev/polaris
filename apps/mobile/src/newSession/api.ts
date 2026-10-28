/** What the sheet calls on a Host's DaemonRpcs. */
import type { Command, HarnessKind, HarnessModels, HostHarnesses } from "@polaris/protocol";

export interface NewSessionApi {
  /** `harness.availability`, from the Daemon's cache. */
  readonly availability: (hostId: string) => Promise<HostHarnesses>;
  /** `harness.models`. */
  readonly models: (hostId: string, harness: HarnessKind) => Promise<HarnessModels>;
  /** `dispatch`; rejects with the Daemon's refusal. */
  readonly dispatch: (hostId: string, command: Command) => Promise<void>;
}
