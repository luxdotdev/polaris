/**
 * What a message carried, above its bubble: images as thumbnails in a box reserved from their
 * stored size, other files (and images that can't be shown) as their name.
 */
import type { Attachment } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { memo, useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useHost, useLiveHost } from "../runtime/hosts.tsx";
import { hostReader, type ImageState, isPreviewable, loadImage } from "./load.ts";
import { diskCache } from "./native.ts";

const EDGE = 180;

/** The thumbnail's box: its stored aspect within EDGE, square when unknown. */
export const boxOf = (attachment: Attachment) => {
  const { width, height } = attachment;

  if (width === null || height === null || width === 0 || height === 0)
    return { width: EDGE * 0.75, height: EDGE * 0.75 };
  const scale = Math.min(1, EDGE / Math.max(width, height));

  return { width: Math.max(48, width * scale), height: Math.max(48, height * scale) };
};

const useImage = (hostId: string, attachment: Attachment): ImageState => {
  const live = useLiveHost(useHost(hostId));

  const [state, setState] = useState<ImageState>(() => {
    const kept = diskCache.uri(attachment.id);

    return kept === null ? { kind: "loading" } : { kind: "ready", uri: kept };
  });

  useEffect(() => {
    if (state.kind === "ready") return;
    let gone = false;

    void loadImage(diskCache, hostReader(live), attachment).then((uri) => {
      if (gone) return;
      setState(
        uri === null ? { kind: live === null ? "loading" : "none" } : { kind: "ready", uri }
      );
    });

    return () => {
      gone = true;
    };
  }, [live, attachment, state.kind]);

  return state;
};

const Thumbnail = ({
  hostId,
  attachment,
}: {
  readonly hostId: string;
  readonly attachment: Attachment;
}) => {
  const state = useImage(hostId, attachment);

  if (state.kind === "none") return <Named attachment={attachment} />;

  return (
    <View
      style={[styles.box, boxOf(attachment)]}
      accessibilityRole="image"
      accessibilityLabel={attachment.name}
    >
      {state.kind === "ready" ? (
        <Image source={{ uri: state.uri }} style={styles.image} resizeMode="cover" />
      ) : null}
    </View>
  );
};

const Named = ({ attachment }: { readonly attachment: Attachment }) => (
  <View style={styles.chip}>
    <Text style={styles.chipText} numberOfLines={1}>
      {attachment.name}
    </Text>
  </View>
);

const ThumbnailsView = ({
  hostId,
  attachments,
}: {
  readonly hostId: string;
  readonly attachments: ReadonlyArray<Attachment>;
}) =>
  attachments.length === 0 ? null : (
    <View style={styles.row}>
      {attachments.map((attachment) =>
        isPreviewable(attachment) ? (
          <Thumbnail key={attachment.id} hostId={hostId} attachment={attachment} />
        ) : (
          <Named key={attachment.id} attachment={attachment} />
        )
      )}
    </View>
  );

export const Thumbnails = memo(ThumbnailsView);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: "88%",
  },
  box: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: midnight.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: midnight.hairline,
  },
  image: { width: "100%", height: "100%" },
  chip: {
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: midnight.surfaceRaised,
  },
  chipText: { ...mobileType.footnote, color: midnight.textSubtle },
});
