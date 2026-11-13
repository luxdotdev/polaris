/**
 * Origins on fixtures, for screenshots against Paper O1–O3 (`#editor/origins…`): three Hosts,
 * `git.blame` and `origins.match` answered per scene. `origins` is O1, `origins-long` O2, and
 * `origins-human`, `-loading`, `-offline`, `-typed`, `-live` O3's states A–E (F is hover and keys).
 */
import {
  type BlameCommit,
  Capability,
  HostId,
  type OriginSession,
  Sequence,
  SessionId,
  TurnId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import type { HostView, PolarisApi } from "../../../../shared/api.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import { type AppState, initialState } from "../../../store/store.ts";
import { HOST, path, ROOT, WORKSPACE } from "../preview/fixtures.ts";

const NOW = Date.now();

const DAY = 86_400_000;

const host = (key: string, label: string, state: HostView["status"]["state"]): HostView => ({
  key,
  label,
  colour: null,
  alias: key === HOST ? null : key,
  kind: key === HOST ? "local" : "ssh",
  proofHarness: false,
  status: {
    state,
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: {
      hostId: HostId.make(`h-${key}`),
      hostname: key,
      platform: "darwin-arm64",
      daemonVersion: "0.9.2",
      homeDir: "/Users/lucas",
      startedAt: "2026-11-13T00:00:00.000Z",
    },
    capabilities: Capability.literals,
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
});

interface Scene {
  readonly file: string;
  readonly line: number;
  readonly commit: BlameCommit | null;
  /** Each Host's sessions for the line; `null` never answers, `offline` isn't connected. */
  readonly hosts: Readonly<Record<string, ReadonlyArray<OriginSession> | null | "offline">>;
}

const SESSION_ROW = path("desktop/src/orchestrator/session-row.tsx");

const RECONNECT = path("daemon/src/hosts/reconnect.ts");

const commit = (sha: string, subject: string, daysAgo: number): BlameCommit => ({
  sha,
  subject,
  authorName: "Lucas Doell",
  authorEmail: "lucas@example.com",
  time: NOW - daysAgo * DAY - 3_600_000,
});

const session = (
  id: string,
  title: string,
  harness: string,
  turns: ReadonlyArray<[number, number]>,
  extra: Partial<OriginSession> = {}
): OriginSession => ({
  sessionId: SessionId.make(id),
  workspaceId: WorkspaceId.make(WORKSPACE),
  title,
  harness,
  sessionState: "idle",
  archived: false,
  celestial: "banded",
  turns: turns.map(([number, time]) => ({
    turnId: TurnId.make(`${id}-${number}`),
    number,
    time,
    prompt: "",
  })),
  ...extra,
});

const PLANNING = session("ses_polaris_planning", "Polaris planning", "claude", [
  [18, NOW - DAY - 600_000],
  [21, NOW - DAY],
]);

const RECONNECT_COMMIT = commit("4d1b0aa3e", "Reconnect waits for the host to answer", 2);

const SCENES = new Map<string, Scene>(
  Object.entries({
    origins: {
      file: SESSION_ROW,
      line: 15,
      commit: commit("8e41d07c2", "Session rows show their Celestial", 1),
      hosts: {
        [HOST]: [
          PLANNING,
          session(
            "ses_layout_study",
            "Orchestrator layout study",
            "claude",
            [[9, NOW - 16 * DAY]],
            {
              archived: true,
              sessionState: "archived",
              celestial: "striped",
            }
          ),
        ],
        mbp: [
          session("ses_spike_gpui", "Spike GPUI review", "codex", [[6, NOW - 2 * DAY]], {
            celestial: "ringed",
          }),
        ],
        "linux-vm": [],
      },
    },
    "origins-long": {
      file: SESSION_ROW,
      line: 15,
      commit: null,
      hosts: {
        [HOST]: [
          session(
            "ses_long",
            "Polaris planning: the session row, its Celestial and every state it can be in",
            "claude",
            [[24, NOW - 20_000]],
            { sessionState: "working" }
          ),
        ],
        mbp: [],
        "linux-vm": [],
      },
    },
    "origins-human": {
      file: RECONNECT,
      line: 20,
      commit: commit("2c7a9e1f0", "Reconnect gives up after 8 tries", 22),
      hosts: { [HOST]: [], mbp: [], "linux-vm": [] },
    },
    "origins-loading": {
      file: RECONNECT,
      line: 20,
      commit: commit("4d1b0aa3e", "Reconnect waits for the host to answer", 1),
      hosts: { [HOST]: null, mbp: null, "linux-vm": null },
    },
    "origins-offline": {
      file: RECONNECT,
      line: 20,
      commit: RECONNECT_COMMIT,
      hosts: {
        [HOST]: [
          session("ses_polaris_planning", "Polaris planning", "claude", [[12, NOW - 2 * DAY]]),
        ],
        mbp: [],
        "linux-vm": "offline",
      },
    },
    "origins-typed": {
      file: RECONNECT,
      line: 20,
      commit: null,
      hosts: { [HOST]: [], mbp: [], "linux-vm": [] },
    },
    "origins-live": {
      file: RECONNECT,
      line: 20,
      commit: null,
      hosts: {
        [HOST]: [
          session("ses_polaris_planning", "Polaris planning", "claude", [[24, NOW - 20_000]], {
            sessionState: "working",
          }),
        ],
        mbp: [],
        "linux-vm": [],
      },
    },
  } satisfies Record<string, Scene>)
);

export const originsScene = (name: string) => SCENES.get(name) ?? null;

const LABELS = new Map([
  [HOST, "Mac Studio"],
  ["mbp", "MacBook Pro"],
  ["linux-vm", "Linux VM"],
]);

export const originsAppState = (scene: Scene): AppState => ({
  ...initialState,
  hosts: Object.entries(scene.hosts).map(([key, answer]) =>
    host(key, LABELS.get(key) ?? key, answer === "offline" ? "offline" : "connected")
  ),
  hostsListed: true,
  hostModels: {
    [HOST]: modelFromSnapshot({
      sequence: Sequence.make(1),
      workspaces: [
        new Workspace({
          id: WorkspaceId.make(WORKSPACE),
          path: ROOT,
          name: "polaris",
          isGitRepo: true,
          worktreeRoot: `${ROOT}.worktrees`,
          hidden: false,
          registeredAt: "2026-10-01T00:00:00.000Z",
        }),
      ],
      worktrees: [],
      sessions: [],
    }),
  },
});

type Request = PolarisApi["request"];

/** Answers `git.blame` and `origins.match` as the scene says; every other request to `rest`. */
export const originsBridge = (scene: Scene, rest: Request): Request =>
  // SAFETY: each branch returns the success shape of the method it answers.
  ((method: string, input: { hostKey: string; startLine?: number }) => {
    if (method === "git.blame")
      return Promise.resolve({
        ok: true,
        value: {
          repoKey: "polaris-root",
          lines: [
            {
              line: input.startLine ?? scene.line,
              path: scene.file.slice(ROOT.length + 1),
              hash: "fixture",
              commit: scene.commit,
            },
          ],
        },
      });

    if (method === "origins.match") {
      const sessions = scene.hosts[input.hostKey];

      if (sessions === null) return new Promise(() => undefined);

      if (sessions === undefined || sessions === "offline")
        return Promise.resolve({ ok: false, error: { code: "Offline", message: "offline" } });

      return Promise.resolve({
        ok: true,
        value: {
          lines: [
            {
              line: scene.line,
              origins: sessions.map((s) => ({
                sessionId: s.sessionId,
                turnIds: s.turns.map((t) => t.turnId),
              })),
            },
          ],
          sessions,
        },
      });
    }

    // SAFETY: any other request goes on unchanged, as the caller made it.
    return rest(method as never, input as never);
  }) as Request;
