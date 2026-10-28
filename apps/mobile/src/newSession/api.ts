/** What the sheet calls on a Host's DaemonRpcs. */
import type {
  Command,
  CommandId,
  HarnessKind,
  HarnessModels,
  HostHarnesses,
} from "@polaris/protocol";

export interface NewSessionApi {
  /** `harness.availability`, from the Daemon's cache unless `refresh` asks it to probe again. */
  readonly availability: (hostId: string, refresh?: boolean) => Promise<HostHarnesses>;
  /** `harness.models`. */
  readonly models: (hostId: string, harness: HarnessKind) => Promise<HarnessModels>;
  /** `dispatch` under `commandId`; rejects with the Daemon's refusal. A retried id applies once. */
  readonly dispatch: (hostId: string, commandId: CommandId, command: Command) => Promise<void>;
}
