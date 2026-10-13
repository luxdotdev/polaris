/**
 * `#completion-card/<scene>`: the tab completion status card on fixtures, for screenshots.
 * `states` lays out the card for every state side by side; `bar` puts the real status item in a
 * status bar over a fixture bridge, for opening the card by hover, focus or click. Its own chunk.
 */
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { Density, HostView, PolarisApi, RequestOutput } from "../../../../../shared/api.ts";
import { HOSTS as NEEDS_YOU_HOSTS } from "../../../needs-you/preview/fixtures.ts";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { standInBridge } from "../../../bridge.ts";
import { CompletionCard, type CompletionCardProps } from "../card/CompletionCard.tsx";
import { BASE, INSPECTION, SCENES, SERVED } from "../card/fixtures.ts";
import { completionCard } from "../card/model.ts";
import { PredictionStatus } from "../Status.tsx";
import { predictionStore } from "../store.ts";

const noop = () => undefined;

const Card = ({
  name,
  ...props
}: Omit<CompletionCardProps, "titleId" | "onRun" | "onModel"> & {
  readonly name: string;
}) => (
  <figure className="flex flex-col gap-2" data-scene={name}>
    <figcaption className="text-caption text-text-faint font-mono">{name}</figcaption>
    {/* The hover card's surface (FLOAT_SURFACE with the popover's row radius), held open. */}
    <div className="rounded-row border-hairline bg-surface-raised text-text-default shadow-float flex w-[360px] flex-col overflow-hidden border">
      <CompletionCard {...props} titleId={`title-${name}`} onRun={noop} onModel={noop} />
    </div>
  </figure>
);

const serving = completionCard({ ...BASE, result: SERVED });

const States = () => (
  <div className="bg-bg flex min-h-screen flex-wrap items-start gap-8 p-8">
    {SCENES.map(([name, input]) => (
      <Card key={name} name={name} view={completionCard(input)} running={null} outcome={null} />
    ))}
    <Card name="clearing" view={serving} running={{ id: "clear-cache" }} outcome={null} />
    <Card
      name="cleared"
      view={serving}
      running={null}
      outcome={{ text: "Cleared the prompt cache in 4 slots.", failed: false }}
    />
    <Card
      name="refused"
      view={serving}
      running={null}
      outcome={{
        text: "This server does not support slots action. Start it with `--slot-save-path`",
        failed: true,
      }}
    />
  </div>
);

const host = (key: string, label: string): HostView => {
  const base = NEEDS_YOU_HOSTS[0];

  if (base === undefined) throw new Error("needs-you fixtures have no Host");

  return { ...base, key, label, alias: null, status: { ...base.status, state: "connected" } };
};

const bridge: PolarisApi = {
  request: async (method) => {
    let value: RequestOutput<"prediction.server" | "prediction.resources.get">;

    if (method === "prediction.server")
      value = { kind: "llama-server", actions: ["clear-cache"], outcome: null };
    else if (method === "prediction.resources.get")
      value = { rssBytes: 9.4 * 1024 ** 3, processes: 1 };
    else return { ok: false, error: { code: "Unsupported", message: "preview" } };

    // SAFETY: each handled fixture method sets its documented output.
    return { ok: true, value: value as never };
  },
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

const Bar = () => (
  <div className="bg-bg flex h-screen flex-col">
    <div className="flex-1" />
    <footer className="border-hairline bg-surface-sunken text-caption text-text-subtle flex h-[26px] shrink-0 items-center gap-4 border-t px-3">
      <span>Pi 4</span>
      <span>main</span>
      <span className="flex-1" />
      <span>Ln 28, Col 14</span>
      <span>Spaces: 2</span>
      <span className="text-text-strong">TypeScript</span>
      <PredictionStatus hostKey="pi" />
    </footer>
  </div>
);

export const mountCompletionCardPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#completion-card\//, "");
  const store = createStore<AppState>(() => ({ ...initialState, hosts: [host("pi", "Pi 4")] }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density: Density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  standInBridge(bridge);
  predictionStore.setState({
    enabled: true,
    configured: true,
    loaded: true,
    inspections: { pi: INSPECTION },
    results: { pi: SERVED },
  });

  createRoot(root).render(
    <AppProvider
      value={{
        connection,
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      {scene === "bar" ? <Bar /> : <States />}
    </AppProvider>
  );

  return connection.setDensity;
};
