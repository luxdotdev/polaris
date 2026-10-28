/** The permission mode each Host last started a session in, kept on this phone. */
import type { PermissionMode } from "@polaris/protocol";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import {
  type PermissionModes,
  parsePermissionModes,
  permissionModeOn,
  type SheetHost,
} from "./model.ts";

const KEY = "polaris.newSession.permissionModes";

export interface PermissionModeStore {
  readonly load: () => Promise<string | null>;
  readonly save: (text: string) => Promise<void>;
}

export const securePermissionModeStore: PermissionModeStore = {
  load: () => SecureStore.getItemAsync(KEY),
  save: (text) => SecureStore.setItemAsync(KEY, text),
};

export interface RememberedModes {
  readonly modes: PermissionModes;
  readonly remember: (hostId: string, mode: PermissionMode) => Promise<void>;
}

export const useRememberedModes = (
  store: PermissionModeStore = securePermissionModeStore
): RememberedModes => {
  const [modes, setModes] = useState<PermissionModes>({});

  useEffect(() => {
    void store.load().then((text) => setModes(parsePermissionModes(text)));
  }, [store]);

  const remember = async (hostId: string, mode: PermissionMode) => {
    const next = { ...parsePermissionModes(await store.load()), [hostId]: mode };

    setModes(next);
    await store.save(JSON.stringify(next));
  };

  return { modes, remember };
};

export interface PermissionChoice {
  /** The mode Start sends on the chosen Host. */
  readonly mode: PermissionMode;
  readonly pick: (mode: PermissionMode) => void;
  /** Keeps `mode` as the Host's next default, after Start. */
  readonly keep: () => void;
}

/** The sheet's mode: a pick holds for its Host; another Host opens on its own last mode. */
export const usePermissionChoice = (
  host: SheetHost | null,
  store?: PermissionModeStore
): PermissionChoice => {
  const remembered = useRememberedModes(store);
  const [picked, setPicked] = useState<{ hostId: string; mode: PermissionMode } | null>(null);
  const pick = picked !== null && picked.hostId === host?.hostId ? picked.mode : undefined;

  const mode =
    host === null ? "plan" : permissionModeOn(host, pick ?? remembered.modes[host.hostId]);

  return {
    mode,
    pick: (next) => {
      if (host !== null) setPicked({ hostId: host.hostId, mode: next });
    },
    keep: () => {
      // Best effort: the session has started either way.
      if (host !== null) void remembered.remember(host.hostId, mode).catch(() => undefined);
    },
  };
};
