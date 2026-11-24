/**
 * When a process started, read from the OS, so a lock can tell its writer
 * from a later process that was given the same pid (after a reboot, say).
 *
 * `identity` is an opaque token that stays the same for the life of a process
 * (across execve too) and doesn't move when the wall clock is stepped, as on
 * a Raspberry Pi without a clock battery. `startedAt` is the wall-clock time,
 * for comparing with an older lock file's mtime. Both are null where the start
 * can't be read: on Windows, without `ps`, or for a pid that has gone.
 */
import { readFileSync } from "node:fs";
import { childEnv } from "../service/childEnv.ts";

export interface ProcessStart {
  readonly identity: string;
  readonly startedAt: number;
}

/** USER_HZ, the unit of /proc's start times: 100 on every Linux architecture Bun runs on. */
const LINUX_TICKS_PER_SECOND = 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const linuxStart = (pid: number): ProcessStart | null => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  // The command name in parentheses may hold spaces; field 22 (starttime) counts from field 3 after it.
  const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const bootTime = /^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1];

  if (ticks === undefined || !/^\d+$/.test(ticks) || bootTime === undefined) return null;

  return {
    identity: `linux:${bootId}:${ticks}`,
    startedAt: (Number(bootTime) + Number(ticks) / LINUX_TICKS_PER_SECOND) * 1000,
  };
};

/** Parses ps's `lstart` in the C locale and UTC, e.g. `Fri Nov 20 15:55:31 2026`. */
const parseLstart = (text: string): number | null => {
  const [, month, day, time, year] = text.trim().split(/\s+/);
  const monthIndex = MONTHS.indexOf(month ?? "");
  const [hours, minutes, seconds] = (time ?? "").split(":").map(Number);

  const startedAt = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    hours ?? Number.NaN,
    minutes ?? Number.NaN,
    seconds ?? Number.NaN
  );

  return monthIndex === -1 || !Number.isFinite(startedAt) ? null : startedAt;
};

const darwinStart = (pid: number): ProcessStart | null => {
  const ps = Bun.spawnSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)], {
    env: { ...childEnv(), LC_ALL: "C", TZ: "UTC" },
    stderr: "ignore",
  });

  if (!ps.success) return null;
  const startedAt = parseLstart(ps.stdout.toString());

  return startedAt === null ? null : { identity: `darwin:${startedAt}`, startedAt };
};

/** The start of process `pid`, or null when this platform or process can't say. */
export const processStart = (pid: number): ProcessStart | null => {
  try {
    if (process.platform === "linux") return linuxStart(pid);

    if (process.platform === "darwin") return darwinStart(pid);

    return null;
  } catch {
    return null;
  }
};
