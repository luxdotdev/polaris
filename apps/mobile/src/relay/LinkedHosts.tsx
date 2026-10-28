/** The linked Hosts and how each is reached, read-only: "via Polaris Relay" and its state. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { StyleSheet, Text, View } from "react-native";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useHosts, useHostStatus } from "../runtime/hosts.tsx";
import { useRelay } from "./RelayProvider.tsx";

const HostRow = ({ connection }: { readonly connection: HostConnection }) => {
  const status = useHostStatus(connection);
  const latency = status.latencyMs === null ? "" : ` · ${status.latencyMs} ms`;

  return (
    <View style={styles.row}>
      <Text style={styles.name} numberOfLines={1}>
        {connection.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        via Polaris Relay · {status.state}
        {latency}
      </Text>
    </View>
  );
};

export const LinkedHosts = () => {
  const relay = useRelay();
  const linked = useHosts().filter((host) => relay.routeOf(host.hostId) === "relay");

  return (
    <View>
      {linked.map((connection) => (
        <HostRow key={connection.hostId} connection={connection} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
    gap: 2,
  },
  name: { ...mobileType.heading, color: midnight.textStrong },
  meta: { ...mobileType.footnote, color: midnight.textSubtle },
});
