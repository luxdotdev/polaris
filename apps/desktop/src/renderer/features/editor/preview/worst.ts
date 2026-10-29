/**
 * Worst-case fixtures for the editor preview (the break-UI pass, ENG-499): a 121-character
 * branch far ahead and behind in a worktree, a remote Host with a long name and latency (or
 * Reconnecting, Offline), and 40 open files with long and duplicate names.
 */
import type { HostView } from "../../../../shared/api.ts";
import { HOSTS } from "../../needs-you/preview/fixtures.ts";
import type { GitFacts } from "../explorer/data/store.ts";
import { HOST, RECONNECT, ROOT } from "./fixtures.ts";

export const WORST_BRANCH =
  "lucas/chrome-/f89ef9eb-03f7-48c1-be24-dbf7769781cf/V5-editor-in-the-new-chrome-eng-520-eng-510-status-strip-morph-and-vim";

export const WORST_GIT: GitFacts = {
  toplevel: ROOT,
  worktree: true,
  head: "b3866053",
  branch: WORST_BRANCH,
  ahead: 128,
  behind: 1284,
  tracking: { upstream: `origin/${WORST_BRANCH}`, gone: false, remote: null },
  marks: { files: new Map(), dirtyFolders: new Set(), changed: 1284 },
  entries: [],
};

const base = (): HostView => {
  const host = HOSTS[0];

  if (host === undefined) throw new Error("needs-you fixtures have no Host");

  return { ...host, key: HOST };
};

/** `?host=`: the status row's Host. `remote` is an SSH Host 284 ms away with a long name. */
export const statusHost = (hash: string): HostView => {
  const which = /[?&]host=([a-z]+)/.exec(hash)?.[1] ?? "local";
  const host = base();

  if (which === "local") return host;

  const remote: HostView = {
    ...host,
    kind: "ssh",
    alias: "build-eu",
    label: "build-farm-eu-west-2.internal.example.com",
    status: { ...host.status, latencyMs: 284.4 },
  };

  if (which === "reconnecting" || which === "offline")
    return { ...remote, status: { ...remote.status, state: which } };

  return remote;
};

const NAMES = [
  "index.ts",
  "reconnectWithExponentialBackoffAndJitter.ts",
  "SessionRowNeedsYouApprovalWellWithLongCommand.tsx",
  "index.ts",
  "README.md",
  "Benachrichtigungseinstellungen.tsx",
  "[...slug].tsx",
  "page.tsx",
  "page.tsx",
  "IMG_20250914_183022_HDR_portrait_edited_edited.HEIC",
];

const DIRS = [
  "daemon/src/engine",
  "desktop/src/renderer/features/editor/prediction/card",
  "packages/protocol/src",
  "apps/site/app/(marketing)/docs/[...slug]",
];

/** 40 files: long, duplicate and bracketed names across deep folders. */
export const WORST_TABS = Array.from({ length: 40 }, (_, i) => {
  const name = NAMES[i % NAMES.length] ?? "index.ts";
  const dir = DIRS[i % DIRS.length] ?? "src";

  return `${ROOT}/${dir}/${i < NAMES.length ? "" : `v${Math.floor(i / NAMES.length)}/`}${name}`;
});

/** Each worst tab's text: the reconnect module, so the language status has TypeScript to show. */
export const worstFiles = (): Record<string, string> =>
  Object.fromEntries(WORST_TABS.map((p) => [p, RECONNECT]));
