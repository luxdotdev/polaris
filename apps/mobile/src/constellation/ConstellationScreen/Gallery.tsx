/**
 * A development screen: the constellation header over the real thread on a fake Host, as MX-W
 * (12 tasks) or MX-X (38). `EXPO_PUBLIC_POLARIS_GALLERY=constellation` (or `:moonlit`).
 */
import { Predicate } from "effect";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalleryHosts } from "../../runtime/hosts.tsx";
import { useTheme } from "../../theme/index.ts";
import { type GalleryHost, galleryHost } from "../../thread/galleryHost.testing.ts";
import { DATASETS, sessionId } from "../../thread/worstCase.testing.ts";
import { type GalleryDataset, galleryConstellation } from "./fixtures.testing.ts";
import { ChartedThread } from "./index.tsx";

// Read whole: Expo inlines EXPO_PUBLIC_ variables only where they are named in full.
const env: unknown = process.env.EXPO_PUBLIC_POLARIS_GALLERY;

const GALLERY = __DEV__ && Predicate.isString(env) ? env : "";

const [PART, THEME] = GALLERY.split(":");

export const constellationGalleryOn = (): boolean => PART === "constellation";

const useGalleryHost = () => {
  const [held, setHeld] = useState<GalleryHost | null>(null);

  useEffect(() => {
    let gone = false;
    let opened: GalleryHost | null = null;

    void galleryHost("gallery-constellation", "mac-studio.local", DATASETS.demo()).then((host) => {
      opened = host;

      if (gone) host.close();
      else setHeld(host);
    });

    return () => {
      gone = true;
      opened?.close();
    };
  }, []);

  return held;
};

const Toggle = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: on }}
    style={{
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: on ? "#ffffff" : "transparent",
    }}
  >
    <Text style={{ fontSize: 12, color: on ? "#000000" : "#a0a0a0" }} allowFontScaling={false}>
      {label}
    </Text>
  </Pressable>
);

export const ConstellationGallery = () => {
  const { colours, name, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [dataset, setDataset] = useState<GalleryDataset>("header");
  const host = useGalleryHost();

  // Once: setTheme is new each render, and the tap to switch must stick.
  useEffect(() => setTheme(THEME === "moonlit" ? "moonlit" : "midnight"), []);

  const source = useMemo(
    () =>
      host === null
        ? null
        : galleryConstellation(dataset, { sessionId, hostId: host.connection.hostId }, Date.now()),
    [host, dataset]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colours.ground }}>
      <View
        style={{
          marginTop: insets.top,
          flexDirection: "row",
          justifyContent: "center",
          gap: 2,
          padding: 3,
          marginHorizontal: 8,
          borderRadius: 999,
          backgroundColor: "#2a2a2a",
        }}
      >
        <Toggle label="MX-W" on={dataset === "header"} onPress={() => setDataset("header")} />
        <Toggle
          label="MX-X"
          on={dataset === "compressed"}
          onPress={() => setDataset("compressed")}
        />
        <Toggle
          label={name}
          on={false}
          onPress={() => setTheme(name === "midnight" ? "moonlit" : "midnight")}
        />
      </View>
      {host === null || source === null ? null : (
        <GalleryHosts hosts={[host.connection]}>
          <ChartedThread
            connection={host.connection}
            constellationId="gallery"
            source={source}
            onBack={undefined}
          />
        </GalleryHosts>
      )}
    </View>
  );
};
