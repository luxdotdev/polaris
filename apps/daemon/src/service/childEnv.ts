/** Explicit environment for children; Bun's default retains the original hand-off envelope. */
export const childEnv = (source: Readonly<Record<string, string | undefined>> = process.env) => {
  const { POLARIS_HANDOFF: _handoff, ...env } = source;

  return env;
};
