import type { Scenario } from "../types.ts";
import { blobs } from "./blobs.ts";
import { coldStart } from "./cold-start.ts";
import { desktopIdle } from "./desktop-idle.ts";
import { files } from "./files.ts";
import { gitScenario } from "./git.ts";
import { history } from "./history.ts";
import { idle } from "./idle.ts";
import { review } from "./review.ts";
import { rules } from "./rules.ts";
import { sessions } from "./sessions.ts";
import { terminal } from "./terminal.ts";
import { usage } from "./usage.ts";
import { usageContention } from "./usage-contention.ts";

/** Every scenario, in the order `bun run bench` runs them. */
export const SCENARIOS: ReadonlyArray<Scenario> = [
  coldStart,
  idle,
  sessions,
  history,
  blobs,
  files,
  gitScenario,
  terminal,
  rules,
  desktopIdle,
  review,
  usage,
  usageContention,
];
