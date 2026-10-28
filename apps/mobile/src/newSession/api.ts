/** What the sheet needs from the app: its Hosts, and three calls on a Host's DaemonRpcs. */
import type { Command, HarnessKind, HarnessModels, HostHarnesses } from "@polaris/protocol";
import { createContext, useContext } from "react";
import type { SheetHost } from "./model.ts";

export interface NewSessionApi {
  /** `harness.availability`, from the Daemon's cache. */
  readonly availability: (hostId: string) => Promise<HostHarnesses>;
  /** `harness.models`. */
  readonly models: (hostId: string, harness: HarnessKind) => Promise<HarnessModels>;
  /** `dispatch`; rejects with the Daemon's refusal. */
  readonly dispatch: (hostId: string, command: Command) => Promise<void>;
}

export interface NewSessionData {
  readonly hosts: ReadonlyArray<SheetHost>;
  readonly api: NewSessionApi;
}

export const NewSessionDataContext = createContext<NewSessionData | null>(null);

export const useNewSessionData = (): NewSessionData | null => useContext(NewSessionDataContext);
