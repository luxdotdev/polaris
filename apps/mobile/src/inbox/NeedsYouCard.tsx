/** Placeholder for S6's `home/ui/NeedsYouCard { item, hostId }` (ENG-534); replaced once it merges. */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "../app/navigation.tsx";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { age } from "../home/model/format.ts";
import { type SessionRow, whereLine } from "../home/model/home.ts";
import { type Reply, respond } from "../home/model/respond.ts";
import { ApprovalActions } from "../home/ui/ApprovalActions.tsx";
import { useTheme } from "../theme";

export const NeedsYouCard = ({
  item,
  hostId,
}: {
  readonly item: SessionRow;
  readonly hostId: string;
}) => {
  const { colours } = useTheme();
  const navigation = useNavigation();
  const connection = useFollowedHosts().find((host) => host.connection.hostId === hostId);
  const open = () => navigation.push({ screen: "thread", hostId, sessionId: item.session.id });

  const { approval } = item;

  const reply = (answer: Reply): Promise<void> =>
    connection === undefined || approval === null
      ? Promise.reject(new Error("host gone"))
      : connection.connection.run((client) => respond(client, approval, answer));

  return (
    <View style={item.stale ? styles.stale : null}>
      <Pressable accessibilityRole="button" onPress={open} style={styles.head}>
        <Text style={[styles.title, { color: colours.textStrong }]} numberOfLines={2}>
          {item.session.title}
        </Text>
        <Text style={[styles.age, { color: colours.textSubtle }]}>
          {age(item.since, Date.now())}
        </Text>
      </Pressable>
      <Text style={[styles.meta, { color: colours.textSubtle }]}>{whereLine(item)}</Text>
      {item.approval === null ? null : (
        <ApprovalActions
          approval={item.approval}
          enabled={!item.stale}
          onReply={reply}
          onOpen={open}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: 10 },
  title: { ...mobileType.heading, flex: 1 },
  age: mobileType.index,
  meta: { ...mobileType.footnote, paddingBottom: 8 },
  stale: { opacity: 0.55 },
});
