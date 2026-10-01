import { Option, Schema } from "effect";
import { useEffect, useMemo } from "react";
import { useApp } from "../../../shell/hooks.ts";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import { type Candidate, createWatcher, type Watcher } from "../model/watcher.ts";
import { pullsStore } from "../store.ts";

const STORAGE_KEY = "polaris.pulls.remotes.v1";

const Saved = Schema.Record(
  Schema.String,
  Schema.Struct({ path: Schema.String, remotes: Schema.Array(Schema.String) })
);

const decodeSaved = Schema.decodeUnknownOption(Schema.fromJsonString(Saved));

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readText = (hostKey: string) => async (path: string) => {
  const result = await polaris().request("files.read", {
    hostKey,
    path,
    offset: null,
    length: 65_536,
  });

  if (!result.ok) return null;
  const { content } = result.value;

  return content.kind === "text" ? content.text : new TextDecoder().decode(content.bytes);
};

let shared: Watcher | null = null;

const watcher = () => {
  shared ??= createWatcher({
    read: readText,
    watch: (workspaces) => void polaris().request("github.watch", { workspaces }),
    load: () => {
      try {
        return Option.getOrElse(decodeSaved(storage()?.getItem(STORAGE_KEY) ?? "{}"), () => ({}));
      } catch {
        return {};
      }
    },
    save: (known) => {
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(known));
      } catch {
        // Storage can be full or blocked; the next launch reads the remotes again.
      }
    },
  });

  return shared;
};

/** Every git Workspace on every Host (hidden ones too), as one string so renders stay rare. */
const candidatesOf = (state: AppState): string => {
  const connected = new Set(
    state.hosts.filter((h) => h.status.state === "connected").map((h) => h.key)
  );

  const candidates = Object.entries(state.hostModels).flatMap(([hostKey, model]) =>
    [...model.workspaces.values()].flatMap((w): ReadonlyArray<Candidate> =>
      w.isGitRepo
        ? [
            {
              hostKey,
              workspaceId: w.id,
              path: w.path,
              readable: connected.has(hostKey) && model.synchronized,
            },
          ]
        : []
    )
  );

  return JSON.stringify(candidates);
};

/**
 * Mounted once in the app: watches every Workspace's GitHub repository and keeps the
 * pull request list and accounts from their feeds in `pullsStore`.
 */
export const PullsPublisher = () => {
  const signature = useApp(candidatesOf);

  // SAFETY: `candidatesOf` serialized an array of `Candidate`.
  const candidates = useMemo(() => JSON.parse(signature) as ReadonlyArray<Candidate>, [signature]);

  useEffect(() => void watcher().update(candidates), [candidates]);

  useEffect(() => {
    const api = polaris();

    const offPulls = api.subscribe(
      "github.pulls",
      {},
      {
        items: (items) => {
          const list = items.at(-1);

          if (list !== undefined) pullsStore.setState({ list });
        },
      }
    );

    const offAccounts = api.subscribe(
      "github.accounts",
      {},
      {
        items: (items) => {
          const accounts = items.at(-1);

          if (accounts !== undefined) pullsStore.setState({ accounts });
        },
      }
    );

    return () => {
      offPulls();
      offAccounts();
    };
  }, []);

  return null;
};
