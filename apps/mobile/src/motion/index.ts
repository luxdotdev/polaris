/** Contract stub for haptics (ENG-534, T2 replaces it with expo-haptics). */
const noop = (): void => undefined;

export const haptics = { approve: noop, send: noop, stop: noop } as const;
