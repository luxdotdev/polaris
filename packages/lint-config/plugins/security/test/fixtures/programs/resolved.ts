// Allowlisted "resolved": its argv[0] is resolved before the spawn, but a bare literal still reports.
declare const argv: string[];

export const run = (cwd: string) => {
  Bun.spawn(argv, { cwd });
  Bun.spawn(["ssh"], { cwd });
  Bun.which("ssh");
};
