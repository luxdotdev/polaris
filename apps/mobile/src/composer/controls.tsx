/**
 * Attach, the mic and the attachment chips (Paper M6), shared by the thread's composer and the
 * new agent session sheet; each screen renders them only when it is given the capability.
 */
import { mobileType } from "@polaris/ui/tokens";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { themedStyles, useTheme } from "../theme/index.ts";
import { type Chip, type Picked, sizeLabel } from "./attach.ts";

/** What a composer needs to offer Attach; given only where the Host stages attachments. */
export interface AttachInput {
  readonly chips: ReadonlyArray<Chip>;
  /** "Attaching 2 files…", or why one failed; null when quiet. */
  readonly caption: string | null;
  readonly pick: () => void;
  /** Stages images that came another way, such as a paste into the composer's field. */
  readonly add: (picks: ReadonlyArray<Picked>) => void;
  readonly remove: (key: string) => void;
}

/** The optional mic; given only where the Host transcribes voice. */
export interface VoiceInput {
  readonly listening: boolean;
  /** Why the last dictation stopped, e.g. the Host has no key; null when it ended cleanly. */
  readonly failure: string | null;
  readonly toggle: () => void;
  /** Send or Queue took the field: the dictation stops and writes nothing more. */
  readonly release: () => void;
}

const Paperclip = () => {
  const { colours } = useTheme();

  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
      <Path
        d="M10.5 4.5 5.8 9.2a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2l-5 5a4.5 4.5 0 0 0 6.4 6.4l4.4-4.4"
        fill="none"
        stroke={colours.textSubtle}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
};

const Mic = ({ colour }: { readonly colour: string }) => (
  <Svg width={15} height={15} viewBox="0 0 16 16">
    <Rect
      x={5.5}
      y={1.5}
      width={5}
      height={8.5}
      rx={2.5}
      fill="none"
      stroke={colour}
      strokeWidth={1.3}
    />
    <Path
      d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"
      fill="none"
      stroke={colour}
      strokeWidth={1.3}
      strokeLinecap="round"
    />
  </Svg>
);

/** M6's pill with its label; `compact` is the paperclip alone, for the thread's footer. */
export const AttachButton = ({
  onPress,
  compact = false,
}: {
  readonly onPress: () => void;
  readonly compact?: boolean;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      style={compact ? styles.round : styles.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Attach a photo or file"
      hitSlop={6}
    >
      <Paperclip />
      {compact ? null : <Text style={styles.pillLabel}>Attach</Text>}
    </Pressable>
  );
};

export const MicButton = ({ voice }: { readonly voice: VoiceInput }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable
      style={[styles.round, voice.listening ? styles.listening : null]}
      onPress={voice.toggle}
      accessibilityRole="button"
      accessibilityLabel={voice.listening ? "Stop dictating" : "Dictate"}
      accessibilityState={{ selected: voice.listening }}
      hitSlop={6}
    >
      <Mic colour={voice.listening ? colours.textStrong : colours.textSubtle} />
    </Pressable>
  );
};

const ChipView = ({ chip, onRemove }: { readonly chip: Chip; readonly onRemove: () => void }) => {
  const styles = useStyles();

  return (
    <View style={[styles.chip, chip.status === "failed" ? styles.chipFailed : null]}>
      {chip.thumbnailUri === null ? null : (
        <Image source={{ uri: chip.thumbnailUri }} style={styles.thumb} />
      )}
      <Text style={styles.chipName} numberOfLines={1}>
        {chip.name}
      </Text>
      {chip.size === null ? null : <Text style={styles.chipSize}>{sizeLabel(chip.size)}</Text>}
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${chip.name}`}
        hitSlop={8}
      >
        <Text style={styles.remove}>×</Text>
      </Pressable>
    </View>
  );
};

/** The source chips over the field, in the order attached; nothing when there are none. */
export const AttachmentChips = ({ attach }: { readonly attach: AttachInput }) => {
  const styles = useStyles();

  return attach.chips.length === 0 ? null : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      keyboardShouldPersistTaps="handled"
    >
      {attach.chips.map((chip) => (
        <ChipView key={chip.key} chip={chip} onRemove={() => attach.remove(chip.key)} />
      ))}
    </ScrollView>
  );
};

const useStyles = themedStyles((colours) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1f",
  },
  pillLabel: { ...mobileType.subhead, color: colours.textDefault },
  round: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  listening: { backgroundColor: colours.fillSelected },
  chips: { gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    maxWidth: 240,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  chipFailed: { borderColor: `${colours.failed}66` },
  thumb: { width: 16, height: 16, borderRadius: 3 },
  chipName: { ...mobileType.index, color: colours.textDefault, flexShrink: 1 },
  chipSize: { ...mobileType.footnote, fontSize: 12, color: colours.textSubtle },
  remove: { ...mobileType.subhead, color: colours.textSubtle },
}));
