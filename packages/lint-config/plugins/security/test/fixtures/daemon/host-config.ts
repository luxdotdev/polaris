// Planted: automatic git asking for the repository's own commands. Three reports.
declare const runGit: (cwd: string, args: ReadonlyArray<string>, options: object) => void;
declare const trusted: boolean;

export const planted = (cwd: string) => {
  runGit(cwd, ["status"], { config: "host" });
  runGit(cwd, ["fetch"], { config: trusted ? "trusted-fetch" : "safe" });
  runGit(cwd, ["diff"], { config: "host" as const });
};

// The default, and an unrelated `config`: no report.
export const fine = (cwd: string) => {
  runGit(cwd, ["status"], { config: "safe" });

  return { config: { host: "x" } };
};
