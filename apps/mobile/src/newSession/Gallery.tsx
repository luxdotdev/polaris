/**
 * A development screen of a new session's states from fixtures, for screenshots: launch a
 * development build with `-polarisDevNewSession <ao|aq|ar|as>` (and `-polarisDevTheme`).
 */
import {
  HarnessAvailability,
  HarnessModels,
  type HarnessStatus,
  HostHarnesses,
  SessionId,
  Timestamp,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Platform, Settings } from "react-native";
import { GalleryHosts } from "../runtime/hosts.tsx";
import { ThemeName, useTheme } from "../theme";
import { type GalleryHost, galleryHost } from "../thread/galleryHost.testing.ts";
import { ThreadScreen } from "../thread/ThreadScreen.tsx";
import { DATASETS, GALLERY_MODELS } from "../thread/worstCase.testing.ts";
import type { NewSessionApi } from "./api.ts";
import type { DraftStore } from "./draftWriter.ts";
import type { SheetHost } from "./model.ts";
import { NewSessionScreen } from "./NewSessionScreen.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";

const GalleryState = Schema.Literals(["ao", "aq", "ar", "as"]);

type GalleryState = typeof GalleryState.Type;

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const STATE = __DEV__ ? launchArgument("polarisDevNewSession", Schema.is(GalleryState)) : null;

export const newSessionGalleryOn = (): boolean => STATE !== null;

const workspace = (id: string, path: string, isGitRepo = true) =>
  Workspace.make({
    id: WorkspaceId.make(id),
    path,
    name: path.split("/").at(-1) ?? id,
    isGitRepo,
    worktreeRoot: `${path}.worktrees`,
    hidden: false,
    registeredAt: Timestamp.make("2026-10-01T00:00:00Z"),
  });

const used = (workspaceId: string, hoursAgo: number) => ({
  workspaceId,
  harness: "claude",
  model: "claude-opus-5-5",
  updatedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
});

const STUDIO: SheetHost = {
  hostId: "studio",
  hostName: "mac-studio",
  connected: true,
  state: "connected",
  latencyMs: 4,
  route: "network",
  homeDir: "/Users/lucas",
  workspaces: [
    workspace("polaris", "/Users/lucas/code/polaris"),
    workspace("nj-homes", "/Users/lucas/code/nj-homes"),
    workspace("sightline", "/Users/lucas/work/sightline"),
  ],
  sessions: [used("polaris", 1), used("nj-homes", 3), used("sightline", 9)],
  capabilities: ["session.plan-mode"],
};

const RPI: SheetHost = {
  hostId: "rpi",
  hostName: "lucas-rpi",
  connected: true,
  state: "connected",
  latencyMs: 31,
  route: "relay",
  homeDir: "/home/lucas",
  workspaces: [
    workspace("dcai", "/home/lucas/dcai"),
    workspace("home-assistant-config", "/home/lucas/home-assistant-config", false),
  ],
  sessions: [used("dcai", 5)],
  capabilities: [],
};

const HOSTS: Readonly<Record<GalleryState, ReadonlyArray<SheetHost>>> = {
  ao: [STUDIO, RPI],
  aq: [STUDIO, { ...RPI, connected: false, state: "reconnecting", latencyMs: null }],
  // The Pi was the last used: it opens there, with nothing ready on it.
  ar: [{ ...STUDIO, sessions: [used("polaris", 9)] }, RPI],
  as: [],
};

const availability = (harness: string, status: HarnessStatus, version: string | null) =>
  HarnessAvailability.make({
    harness,
    status,
    version,
    minVersion: "2.1.0",
    olderThanTested: null,
    signInKind: null,
    detail: null,
    signInArgv: null,
  });

const READY = HostHarnesses.make({
  harnesses: [availability("claude", "ready", "2.1.4"), availability("codex", "ready", "0.9.0")],
  checkedAt: "2026-10-29T09:00:00Z",
});

const NONE = HostHarnesses.make({
  harnesses: [
    availability("claude", "outdated", "2.0.9"),
    availability("codex", "not-installed", null),
  ],
  checkedAt: "2026-10-29T09:00:00Z",
});

const api = (state: GalleryState): NewSessionApi => ({
  availability: (hostId) => Promise.resolve(state === "ar" && hostId === "rpi" ? NONE : READY),
  models: (_, harness) =>
    Promise.resolve(
      HarnessModels.make({
        harness,
        models: GALLERY_MODELS,
        switchesModel: true,
        backgroundsCommands: false,
        runsShellCommands: true,
        fetchedAt: "2026-10-29T09:00:00Z",
      })
    ),
  dispatch: () => Promise.reject(new Error("the gallery starts nothing")),
});

const NO_DRAFTS: DraftStore = { load: () => Promise.resolve(null), save: () => Promise.resolve() };

/** MX-AS: the real thread over the gallery's fake Host, rising. */
const Started = () => {
  const [host, setHost] = useState<GalleryHost | null>(null);

  useEffect(() => {
    let opened: GalleryHost | null = null;

    void galleryHost("gallery-started", "mac-studio", DATASETS.started()).then((made) => {
      opened = made;
      setHost(made);
    });

    return () => opened?.close();
  }, []);

  return host === null ? null : (
    <GalleryHosts hosts={[host.connection]}>
      <ThreadScreen
        hostId={host.connection.hostId}
        sessionId={SessionId.make("s1")}
        onBack={() => undefined}
        rise
      />
    </GalleryHosts>
  );
};

export const NewSessionGallery = () => {
  const { setTheme } = useTheme();
  const state: GalleryState = STATE ?? "ao";
  const hosts = HOSTS[state];
  const [fake] = useState(() => api(state));
  const [placing, setPlacing] = useState(false);

  // Opened after the field takes focus, as a tap on the place line would.
  useEffect(() => {
    if (state !== "aq") return;
    const timer = setTimeout(() => setPlacing(true), 1500);

    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  if (state === "as") return <Started />;

  return (
    <>
      <NewSessionScreen
        hosts={hosts}
        api={fake}
        connectionFor={() => null}
        onStarted={() => undefined}
        onBack={() => undefined}
        draftStore={NO_DRAFTS}
      />
      <WorkspaceSheet
        open={placing}
        onClose={() => undefined}
        hosts={hosts}
        target={{ hostId: "studio", workspaceId: "polaris" }}
        onPick={() => undefined}
        worktree={{
          on: true,
          caption: "On: works on polaris/fix-the-relay-reconnect-backoff-7f3a",
          enabled: true,
          onChange: () => undefined,
        }}
      />
    </>
  );
};
