export type Run = (argv: ReadonlyArray<string>) => string;

export const run: Run = (argv) => {
  const result = Bun.spawnSync([...argv], { stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0)
    throw new Error(`${argv[0]} failed (${result.exitCode})\n${result.stderr.toString()}`);

  return result.stdout.toString();
};
