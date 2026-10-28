/**
 * This iPhone's switch for notifications when a constellation needs you (Paper M9), on by
 * default. Each Host learns it from this device's push registration, so it stops sending them.
 */
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { createPreference } from "./preference.ts";

const KEY = "polaris.push.constellations";

export const constellationNotifications = createPreference({
  load: () => SecureStore.getItemAsync(KEY),
  save: (value) => SecureStore.setItemAsync(KEY, value),
});

/** The switch's current value, re-rendering when it changes. */
export const useConstellationNotifications = (): boolean =>
  useSyncExternalStore(constellationNotifications.subscribe, constellationNotifications.get);
