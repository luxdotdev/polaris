/** One Host's feed over the gateway, from a pairing string, as React state. */
import { createPolaris, type HostView, type PolarisClient } from "@polaris/sdk";
import { useEffect, useState } from "react";

export type HostFeed =
  | { readonly kind: "connecting" }
  | { readonly kind: "live"; readonly view: HostView }
  | { readonly kind: "failed"; readonly message: string };

const follow = async (
  pairing: string,
  onClient: (client: PolarisClient) => void,
  onView: (view: HostView) => void
) => {
  const client = await createPolaris({ pairings: [pairing], clientName: "Polaris Mobile" });

  onClient(client);
  const host = client.hosts[0];

  if (host === undefined) throw new Error("the pairing names no host");

  for await (const view of client.subscribeHost(host.hostId)) onView(view);
};

export const useHostFeed = (pairing: string | null): HostFeed | null => {
  const [feed, setFeed] = useState<HostFeed | null>(null);

  useEffect(() => {
    if (pairing === null) {
      setFeed(null);

      return;
    }

    let stopped = false;
    let client: PolarisClient | null = null;

    setFeed({ kind: "connecting" });

    const onClient = (opened: PolarisClient) => {
      client = opened;

      if (stopped) void opened.close();
    };

    const onView = (view: HostView) => {
      if (!stopped) setFeed({ kind: "live", view });
    };

    const run = async () => {
      try {
        await follow(pairing, onClient, onView);
      } catch (error) {
        if (!stopped) setFeed({ kind: "failed", message: String(error) });
      }
    };

    void run();

    return () => {
      stopped = true;
      void client?.close();
    };
  }, [pairing]);

  return feed;
};
