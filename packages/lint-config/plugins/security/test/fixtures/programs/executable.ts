// Allowlisted "resolver": the one file that may call Bun.which.
export const find = (name: string, PATH: string) => Bun.which(name, { PATH });
