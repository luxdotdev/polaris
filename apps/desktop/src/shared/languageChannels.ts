/** Dedicated typed language IPC, separate from the legacy request table. */
export const LANGUAGE_CHANNELS = {
  request: "polaris:languages:request",
  subscribe: "polaris:languages:subscribe",
  unsubscribe: "polaris:languages:unsubscribe",
  entries: "polaris:languages:entries",
} as const;
