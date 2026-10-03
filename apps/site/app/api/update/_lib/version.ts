export interface Version {
  readonly text: string;
  readonly core: readonly bigint[];
  readonly prerelease: readonly string[];
}

const identifier = /^(0|[1-9]\d*)$/;

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;

export function parseVersion(text: string): Version | null {
  if (text.length > 128) return null;
  const match = semver.exec(text);

  if (!match || match[0] !== text) return null;
  const prerelease = match[4]?.split(".") ?? [];

  if (prerelease.some((part) => /^\d+$/.test(part) && !identifier.test(part))) return null;

  return {
    text,
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
    prerelease,
  };
}

function compareIdentifier(a: string, b: string): number {
  if (a === b) return 0;
  const aNumeric = identifier.test(a);
  const bNumeric = identifier.test(b);

  if (aNumeric && bNumeric) return BigInt(a) < BigInt(b) ? -1 : 1;

  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;

  return a < b ? -1 : 1;
}

export function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index]! < b.core[index]! ? -1 : 1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  if (a.length === 0) return 1;

  if (b.length === 0) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];

    if (left === undefined) return -1;

    if (right === undefined) return 1;
    const comparison = compareIdentifier(left, right);

    if (comparison !== 0) return comparison;
  }

  return 0;
}
