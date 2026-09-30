/** A Host's `harness.availability`, asked once it's connected; null until it answers. */
import { useEffect, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import type { Availability } from "../model.ts";

export const useAvailability = (hostKey: string | null): Availability | null => {
  const canAsk = useApp((s) =>
    s.hosts.some((h) => h.key === hostKey && h.status.capabilities.includes("harness.availability"))
  );

  const [report, setReport] = useState<{ key: string; value: Availability | null } | null>(null);

  useEffect(() => {
    if (!canAsk || hostKey === null) return undefined;
    let live = true;

    void window.polaris
      .request("harness.availability", { hostKey, refresh: false })
      .then((result) => {
        if (live) setReport({ key: hostKey, value: result.ok ? result.value : null });
      });

    return () => {
      live = false;
    };
  }, [canAsk, hostKey]);

  return report?.key === hostKey ? report.value : null;
};
