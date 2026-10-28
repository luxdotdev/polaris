/**
 * Push in the app: the notification categories, a registration with every linked Host as it
 * comes live, and answers from approval notifications (apps/mobile/README.md: Push).
 */
import type { RelayAddress } from "@polaris/protocol/relay";
import type { RelayIdentity } from "@polaris/protocol/relay/party";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { PolarisPush } from "../../modules/polaris-push/index.ts";
import { useHosts } from "../runtime/hosts.tsx";
import { answerOf, PUSH_CATEGORIES } from "./answer.ts";
import { answerHost, sendAnswer } from "./deliver.ts";
import { type PushDevice, registerPush } from "./registration.ts";

/** A Host linked over the relay: where its registration's ticket points. */
export interface PushLinkedHost {
  readonly hostId: string;
  readonly hostAddress: RelayAddress;
}

const setCategories = () =>
  Promise.all(
    PUSH_CATEGORIES.map((category) =>
      Notifications.setNotificationCategoryAsync(category.identifier, [...category.actions])
    )
  );

/** The device's push identity, or null when notifications aren't allowed. */
const pushDevice = async (identity: RelayIdentity): Promise<PushDevice | null> => {
  const permission = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });

  if (!permission.granted) return null;
  const token = await Notifications.getDevicePushTokenAsync();

  return {
    token: String(token.data).toLowerCase(),
    environment: PolarisPush.apnsEnvironment(),
    pushKey: await PolarisPush.pushKey(),
    identity,
  };
};

const userInfoOf = (response: Notifications.NotificationResponse): ReadonlyArray<unknown> => {
  const { content, trigger } = response.notification.request;

  return [content.data, trigger !== null && "payload" in trigger ? trigger.payload : null];
};

const useAnswers = () => {
  const hosts = useHosts();
  const current = useRef(hosts);
  current.current = hosts;

  useEffect(() => {
    const answer = async (response: Notifications.NotificationResponse) => {
      const found = answerOf({
        actionIdentifier: response.actionIdentifier,
        userInfo: userInfoOf(response),
      });

      if (found === null) return;
      const id = String(found.dispatch.commandId);
      await PolarisPush.beginAnswer(id);

      try {
        await sendAnswer(current.current.map(answerHost), found);
      } finally {
        await PolarisPush.endAnswer(id);
        Notifications.clearLastNotificationResponse();
      }
    };

    // An action can launch the app before this listener exists; that one is the last response.
    void Notifications.getLastNotificationResponseAsync().then((last) =>
      last === null ? undefined : answer(last)
    );

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => void answer(response)
    );

    return () => subscription.remove();
  }, []);
};

const useRegistrations = (
  identity: RelayIdentity | null,
  linked: ReadonlyArray<PushLinkedHost>
) => {
  const hosts = useHosts();
  const [device, setDevice] = useState<PushDevice | null>(null);
  // Per Host, the connection epoch it was registered on: a reconnect registers again.
  const registered = useRef(new Map<string, number>());

  useEffect(() => {
    if (identity === null) return;
    void setCategories()
      .then(() => pushDevice(identity))
      .then(setDevice);
  }, [identity]);

  useEffect(() => {
    if (device === null) return;

    const sync = () => {
      for (const { hostId, hostAddress } of linked) {
        const host = hosts.find((h) => h.hostId === hostId);
        const live = host?.live() ?? null;

        if (host === undefined || live === null) continue;

        if (registered.current.get(hostId) === live.epoch) continue;
        registered.current.set(hostId, live.epoch);
        void registerPush(host, device, hostAddress).catch(() => registered.current.delete(hostId));
      }
    };

    sync();
    const unsubscribes = hosts.map((host) => host.subscribe(sync));

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [device, hosts, linked]);
};

/** Mount once, under HostsProvider, with the device's relay identity and its linked Hosts. */
export const usePush = (identity: RelayIdentity | null, linked: ReadonlyArray<PushLinkedHost>) => {
  useAnswers();
  useRegistrations(identity, linked);
};
