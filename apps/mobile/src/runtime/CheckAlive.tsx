/**
 * Coming back to the front, each live connection proves it still answers: a link can die
 * while the app is suspended without its socket closing (ADR 0084). Mount once, under
 * HostsProvider.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { useHosts } from "./hosts.tsx";

export const CheckAlive = () => {
  const hosts = useHosts();

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") for (const host of hosts) host.checkAlive();
    });

    return () => listener.remove();
  }, [hosts]);

  return null;
};
