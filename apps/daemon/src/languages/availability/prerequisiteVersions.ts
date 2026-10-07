import type { VersionProbe } from "./probes.ts";

const version = (pattern: RegExp, stderr = false): VersionProbe => ({
  argv: ["--version"],
  parse: (output) => pattern.exec(stderr ? output.stderr : output.stdout)?.[1] ?? null,
});

/** Only known runtime banners produce a version; other observations remain unknown. */
export const prerequisiteVersions = {
  php: version(/^PHP (\d+\.\d+\.\d+)/),
  java: {
    argv: ["-version"],
    parse: (output) => {
      const detected = /(?:openjdk|java) version "(\d+(?:\.\d+){0,2})/.exec(output.stderr)?.[1];

      if (detected === undefined) return null;
      const parts = detected.split(".");

      while (parts.length < 3) parts.push("0");

      return parts.join(".");
    },
  },
  go: {
    ...version(/^go version go(\d+\.\d+(?:\.\d+)?)/),
    argv: ["version"],
  },
} satisfies Readonly<Record<string, VersionProbe>>;
