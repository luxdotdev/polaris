/**
 * "Check out on": every Host whose Workspace holds the pull request's repository, the last
 * used first (ENG-185), then in the PR list's order. Pure over plain facts.
 */

export interface Place {
  readonly hostKey: string;
  readonly workspaceId: string;
}

export interface PlaceHost {
  readonly key: string;
  readonly label: string;
  /** The local Host ("this Mac"). */
  readonly local: boolean;
  readonly state: "connected" | "reconnecting" | "needs-attention" | "offline";
  readonly latencyMs: number | null;
}

export interface HostChoice {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly label: string;
  /** "last used · nj-homes", "this Mac · nj-homes". */
  readonly caption: string;
  /** "18 ms", "local", "offline". */
  readonly trailing: string;
  readonly current: boolean;
  /** Only a connected Host can check out. */
  readonly enabled: boolean;
}

/** The last used Host first; the rest keep their order. */
export const orderPlaces = <P extends Place>(
  places: ReadonlyArray<P>,
  lastHostKey: string | null
): ReadonlyArray<P> => {
  const last = places.filter((p) => p.hostKey === lastHostKey);

  return last.length === 0 ? places : [...last, ...places.filter((p) => p.hostKey !== lastHostKey)];
};

/** Where a pull request opens on its own: the last used Host if connected, else the first connected. */
export const placeToOpen = <P extends Place>(
  places: ReadonlyArray<P>,
  lastHostKey: string | null,
  connected: (hostKey: string) => boolean
): P | null => orderPlaces(places, lastHostKey).find((p) => connected(p.hostKey)) ?? null;

const trailingOf = (host: PlaceHost) => {
  if (host.state === "reconnecting") return "reconnecting";

  if (host.state !== "connected") return "offline";

  if (host.local) return "local";

  return host.latencyMs === null ? "" : `${Math.round(host.latencyMs)} ms`;
};

export interface ChoicesInput {
  readonly places: ReadonlyArray<Place>;
  readonly hosts: ReadonlyArray<PlaceHost>;
  readonly workspaceName: (place: Place) => string | null;
  readonly lastHostKey: string | null;
  /** The Host whose checkout the chip shows; null with none. */
  readonly currentHostKey: string | null;
}

/** One row per Host (the first Workspace there that holds the repository). */
export const hostChoices = (input: ChoicesInput): ReadonlyArray<HostChoice> => {
  const seen = new Set<string>();

  return orderPlaces(input.places, input.lastHostKey).flatMap(
    (place): ReadonlyArray<HostChoice> => {
      const host = input.hosts.find((h) => h.key === place.hostKey);

      if (host === undefined || seen.has(place.hostKey)) return [];
      seen.add(place.hostKey);

      const caption = [
        place.hostKey === input.lastHostKey ? "last used" : null,
        host.local ? "this Mac" : null,
        input.workspaceName(place),
      ]
        .filter((part) => part !== null)
        .join(" · ");

      return [
        {
          hostKey: place.hostKey,
          workspaceId: place.workspaceId,
          label: host.label,
          caption,
          trailing: trailingOf(host),
          current: place.hostKey === input.currentHostKey,
          enabled: host.state === "connected",
        },
      ];
    }
  );
};
