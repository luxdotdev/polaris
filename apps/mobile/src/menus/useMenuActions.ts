/**
 * Runs what a long-press menu chose: navigation, a reply through the Host's connection, the
 * pasteboard, or a reconnect. A refused reply is an alert in the Host's own words.
 */
import { Effect, Match } from "effect";
import { useCallback } from "react";
import { Alert } from "react-native";
import { useNavigation } from "../app/navigation.tsx";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { newCommandId } from "../home/model/respond.ts";
import { NotConnected } from "../runtime/hostConnection.ts";
import { copyText } from "./LongPressMenu.tsx";
import { failureTitle, type MenuAction, replyCommand } from "./model.ts";

/** "Interrupt the turn in flight first": the reason, first letter up. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const useMenuActions = (): ((action: MenuAction) => void) => {
  const navigation = useNavigation();
  const hosts = useFollowedHosts();

  return useCallback(
    (action: MenuAction) => {
      const followed = (hostId: string) =>
        hosts.find(({ connection }) => connection.hostId === hostId);

      Match.value(action).pipe(
        Match.discriminatorsExhaustive("kind")({
          "open-session": ({ hostId, sessionId }) =>
            navigation.push({ screen: "thread", hostId, sessionId }),
          "open-review": ({ hostId, sessionId }) =>
            navigation.push({ screen: "review", hostId, sessionId, turnId: null }),
          "open-constellation": ({ hostId, constellationId }) =>
            navigation.push({ screen: "constellation", hostId, constellationId }),
          copy: ({ text }) => void copyText(text),
          "retry-host": ({ hostId }) => followed(hostId)?.connection.retryNow(),
          reply: (sending) => {
            const { hostId, reply } = sending;
            const host = followed(hostId);
            const name = host?.status.host?.hostname ?? host?.connection.name ?? "The host";
            const command = replyCommand(sending);

            // A refusal resolves with the Host's reason; only a dropped connection rejects.
            const sent =
              host === undefined
                ? Promise.reject(new NotConnected(hostId))
                : host.connection.run((client) =>
                    client
                      .dispatch({ commandId: newCommandId(), command })
                      .pipe(
                        Effect.match({ onFailure: (error) => error.message, onSuccess: () => null })
                      )
                  );

            void sent
              .catch(() => `${name} isn't connected.`)
              .then((refusal) => {
                if (refusal !== null) Alert.alert(failureTitle(reply), sentence(refusal));
              });
          },
        })
      );
    },
    [hosts, navigation]
  );
};
