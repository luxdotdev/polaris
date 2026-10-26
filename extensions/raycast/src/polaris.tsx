// Portions adapted from raycast/extensions@3048c09 zed-recent-projects/src/components/with-zed.tsx (MIT)
/**
 * `withPolaris` opens one SDK client over the stored pairings and follows
 * every Host. While none can be shown, it shows why instead of the command.
 */
import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  LocalStorage,
  launchCommand,
  LaunchType,
} from "@raycast/api";
import { createPolaris, type HostView, type PolarisClient } from "@polaris/sdk";
import {
  type ComponentType,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AddPairingForm } from "./components/AddPairingForm.tsx";
import { availability } from "./lib/connection.ts";
import { describeFailure, failureMarkdown, unavailableMarkdown } from "./lib/copy.ts";
import { isLocal, readPairings, type StoredPairing } from "./lib/pairings.ts";

export const CLIENT_NAME = "Raycast";

export interface PolarisContext {
  readonly client: PolarisClient;
  /** Every Host's latest view, in pairing order. */
  readonly views: ReadonlyArray<HostView>;
  readonly pairings: ReadonlyArray<StoredPairing>;
  /** Hosts on this Mac, whose paths Finder can show. */
  readonly localHosts: ReadonlySet<string>;
  readonly reload: () => void;
}

type Feed =
  | { readonly kind: "loading" }
  | { readonly kind: "unpaired" }
  | { readonly kind: "failed"; readonly error: Error | null }
  | {
      readonly kind: "ready";
      readonly client: PolarisClient;
      readonly views: ReadonlyArray<HostView>;
      readonly pairings: ReadonlyArray<StoredPairing>;
    };

const Context = createContext<PolarisContext | null>(null);

const follow = async (
  set: (feed: Feed) => void,
  isClosed: () => boolean,
  onClient: (client: PolarisClient) => void
) => {
  const pairings = await readPairings(LocalStorage);

  if (pairings.length === 0) return set({ kind: "unpaired" });

  const client = await createPolaris({
    pairings: pairings.map((p) => p.pairing),
    clientName: CLIENT_NAME,
  });

  onClient(client);

  for await (const views of client.subscribeHosts()) {
    if (isClosed()) break;
    set({ kind: "ready", client, views, pairings });
  }
};

const useFeed = () => {
  const [feed, setFeed] = useState<Feed>({ kind: "loading" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let closed = false;
    let client: PolarisClient | null = null;

    follow(
      (next) => {
        if (!closed) setFeed(next);
      },
      () => closed,
      (opened) => {
        client = opened;

        if (closed) void opened.close();
      }
    ).catch((error: Error | null) => {
      if (!closed) setFeed({ kind: "failed", error: error instanceof Error ? error : null });
    });

    return () => {
      closed = true;
      void client?.close();
    };
  }, [generation]);

  const reload = useCallback(() => {
    setFeed({ kind: "loading" });
    setGeneration((g) => g + 1);
  }, []);

  return { feed, reload };
};

const UNPAIRED = [
  "# Pair Raycast with Polaris",
  "",
  "In Polaris, open Settings → Extensions, pair Raycast with what it may do, and copy the pairing string.",
  "",
  "Then add it here. Add one pairing for each host.",
].join("\n");

const Recovery = (props: { readonly reload: () => void; readonly markdown: string }) => (
  <Detail
    markdown={props.markdown}
    actions={
      <ActionPanel>
        <Action.Push
          title="Add Pairing"
          icon={Icon.Plus}
          target={<AddPairingForm onAdded={props.reload} />}
        />
        <Action
          title="Try Again"
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
          onAction={props.reload}
        />
        <Action
          title="Open Hosts"
          icon={Icon.Network}
          onAction={() => launchCommand({ name: "hosts", type: LaunchType.UserInitiated })}
        />
      </ActionPanel>
    }
  />
);

export const withPolaris =
  <P extends object>(Component: ComponentType<P>) =>
  (props: P) => {
    const { feed, reload } = useFeed();

    if (feed.kind === "loading") return <Detail isLoading markdown="" />;

    if (feed.kind === "unpaired") return <Recovery reload={reload} markdown={UNPAIRED} />;

    if (feed.kind === "failed") {
      const failure = describeFailure(feed.error, "connect");

      return <Recovery reload={reload} markdown={failureMarkdown(failure)} />;
    }

    const status = availability(feed.views, feed.client.hosts.length);

    if (status === "waiting") return <Detail isLoading markdown="" />;

    if (status === "unavailable")
      return <Recovery reload={reload} markdown={unavailableMarkdown(feed.views)} />;

    const localHosts = new Set(
      feed.pairings.filter((p) => isLocal(p.pairing)).map((p) => p.pairing.hostId)
    );

    return (
      <Context.Provider
        value={{
          client: feed.client,
          views: feed.views,
          pairings: feed.pairings,
          localHosts,
          reload,
        }}
      >
        <Component {...props} />
      </Context.Provider>
    );
  };

export const usePolaris = (): PolarisContext => {
  const context = useContext(Context);

  if (context === null) throw new Error("usePolaris is used outside withPolaris");

  return context;
};
