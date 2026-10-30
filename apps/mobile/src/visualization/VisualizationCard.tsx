/**
 * A Visualization in the thread (DESIGN.md, Visualizations V7a/V7b): a card at most 300pt tall
 * with its title line, the frame inline without inner scrolling, and Expand to a full-height sheet.
 */
import { mobileType } from "@polaris/ui/tokens";
import { memo, useCallback, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Celestial } from "../celestial";
import type { CelestialBody, HarnessKind } from "@polaris/protocol";
import { type MobileColours, themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { confirmLink } from "./confirmLink.ts";
import type { Visualization } from "./model.ts";
import { VisualizationFrame } from "./VisualizationFrame.tsx";

/** The card is 300pt; its title line takes 40. */
export const TITLE_HEIGHT = 40;

export const INLINE_BODY_MAX = 300 - TITLE_HEIGHT;

const FADE = 72;

/** Each Visualization's last reported height, so a remounted card keeps its place. */
const heights = new Map<string, number>();

const useStyles = themedStyles((colours) => makeStyles(colours));

/** The 14pt pixel three-bar glyph. */
const Glyph = ({ faded = false }: { readonly faded?: boolean }) => {
  const styles = useStyles();

  return (
    <View style={[styles.glyph, faded ? styles.glyphFaded : null]}>
      {[6, 14, 10].map((height) => (
        <View key={height} style={[styles.bar, { height }]} />
      ))}
    </View>
  );
};

const Fade = ({ colour }: { readonly colour: string }) => (
  <Svg width="100%" height={FADE} style={{ position: "absolute", bottom: 0 }} pointerEvents="none">
    <Defs>
      <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={colour} stopOpacity={0} />
        <Stop offset="1" stopColor={colour} stopOpacity={1} />
      </LinearGradient>
    </Defs>
    <Rect width="100%" height={FADE} fill="url(#fade)" />
  </Svg>
);

/** The body after the frame tried to open another page (DESIGN.md, Stopped). */
const Stopped = () => {
  const styles = useStyles();

  return (
    <View style={styles.stopped}>
      <Text style={styles.stoppedTitle} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        Stopped: it tried to open another page
      </Text>
      <Text style={styles.stoppedBody} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        A visualization has to stay on its own page, so Polaris removed it. Ask the agent to draw it
        again.
      </Text>
    </View>
  );
};

export interface CardSession {
  readonly body: CelestialBody;
  readonly harness: HarnessKind;
}

export interface VisualizationCardProps {
  readonly visualization: Visualization;
  /** A later Visualization replaces this one: it collapses to its title line. */
  readonly revised: boolean;
  /** It may hold a live WebView now (`live.ts`); otherwise its place is kept empty. */
  readonly live: boolean;
  readonly session: CardSession | undefined;
}

const ExpandedSheet = ({
  visualization,
  onClose,
  onStopped,
  onState,
}: {
  readonly visualization: Visualization;
  readonly onClose: () => void;
  readonly onStopped: () => void;
  readonly onState: () => void;
}) => {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheet, { marginTop: insets.top + 10 }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Glyph />
          <Text
            style={styles.sheetTitle}
            numberOfLines={1}
            accessibilityRole="header"
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          >
            {visualization.title}
          </Text>
          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.doneLabel}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.sheetBody, { paddingBottom: Math.max(18, insets.bottom) }]}>
          <VisualizationFrame
            visualization={visualization}
            mode="expanded"
            onOpenLink={(url) => confirmLink(visualization.title, url)}
            onStopped={onStopped}
            onState={onState}
            style={styles.fill}
          />
        </View>
      </View>
    </Modal>
  );
};

const Drawing = ({
  title,
  session,
}: {
  readonly title: string;
  readonly session: CardSession | undefined;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.card}>
      <View style={[styles.titleLine, styles.titleLive]}>
        {session === undefined ? (
          <Glyph />
        ) : (
          <Celestial body={session.body} harness={session.harness} size={14} working />
        )}
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {title === "" ? "Drawing…" : `Drawing ${title}…`}
        </Text>
      </View>
      <View style={{ height: INLINE_BODY_MAX }} />
    </View>
  );
};

const Revised = ({
  title,
  open,
  onToggle,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      style={[styles.titleLine, styles.revised]}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <Glyph faded />
      <Text
        style={styles.revisedTitle}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        {title}
      </Text>
      <Text style={styles.revisedNote}>Revised below</Text>
      <Text style={[styles.chevron, open ? styles.chevronOpen : null]}>›</Text>
    </Pressable>
  );
};

const VisualizationCardView = ({
  visualization,
  revised,
  live,
  session,
}: VisualizationCardProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const { id, title } = visualization;
  const [height, setHeight] = useState<number | null>(() => heights.get(id) ?? null);
  const [expanded, setExpanded] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [openedRevision, setOpenedRevision] = useState(false);
  // The sheet saved state the inline frame hasn't seen: reload it when the sheet closes.
  const [generation, setGeneration] = useState(0);
  const sheetSaved = useRef(false);

  const onHeight = useCallback(
    (next: number) => {
      heights.set(id, next);
      setHeight(next);
    },
    [id]
  );

  const stop = useCallback(() => {
    setStopped(true);
    setExpanded(false);
  }, []);

  if (visualization.drawing) return <Drawing title={title} session={session} />;

  if (revised && !openedRevision)
    return <Revised title={title} open={false} onToggle={() => setOpenedRevision(true)} />;

  const shown = Math.min(height ?? INLINE_BODY_MAX, INLINE_BODY_MAX);
  const overflows = height !== null && height > INLINE_BODY_MAX;

  const close = () => {
    setExpanded(false);

    if (sheetSaved.current) setGeneration((n) => n + 1);
    sheetSaved.current = false;
  };

  return (
    <View style={styles.card}>
      {revised ? (
        <Revised title={title} open onToggle={() => setOpenedRevision(false)} />
      ) : (
        <Pressable
          style={styles.titleLine}
          disabled={stopped}
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`${title}, expand`}
        >
          <Glyph />
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {title}
          </Text>
          {stopped ? null : <Text style={styles.expandGlyph}>⤢</Text>}
        </Pressable>
      )}
      {stopped ? (
        <Stopped />
      ) : (
        <View style={{ height: shown }}>
          {live ? (
            <VisualizationFrame
              key={generation}
              visualization={visualization}
              mode="inline"
              onHeight={onHeight}
              onOpenLink={(url) => confirmLink(title, url)}
              onStopped={stop}
              style={styles.fill}
            />
          ) : null}
          {overflows ? (
            <>
              <Fade colour={colours.panel} />
              <Pressable
                style={styles.tapToExpand}
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
              >
                <Text style={styles.tapLabel} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
                  Tap to expand
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}
      {expanded ? (
        <ExpandedSheet
          visualization={visualization}
          onClose={close}
          onStopped={stop}
          onState={() => {
            sheetSaved.current = true;
          }}
        />
      ) : null}
    </View>
  );
};

export const VisualizationCard = memo(VisualizationCardView);

const makeStyles = (colours: MobileColours) =>
  ({
    card: {
      backgroundColor: colours.panel,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colours.hairline,
      overflow: "hidden",
      marginBottom: 8,
    },
    titleLine: {
      height: TITLE_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 12,
      paddingRight: 12,
      backgroundColor: colours.well,
      borderBottomWidth: 1,
      borderBottomColor: colours.hairline,
    },
    titleLive: { backgroundColor: colours.raised },
    title: { ...mobileType.subhead, fontWeight: "500", color: colours.textStrong, flex: 1 },
    expandGlyph: { ...mobileType.subhead, color: colours.textSubtle },
    glyph: { width: 14, height: 14, flexDirection: "row", alignItems: "flex-end", gap: 2 },
    glyphFaded: { opacity: 0.6 },
    bar: { width: 3, backgroundColor: colours.textSubtle },
    revised: { backgroundColor: "transparent", borderBottomWidth: 0, marginBottom: 8 },
    revisedTitle: { ...mobileType.subhead, color: colours.textSubtle, flex: 1 },
    revisedNote: { ...mobileType.index, color: colours.textSubtle },
    chevron: { ...mobileType.subhead, color: colours.textFaint },
    chevronOpen: { transform: [{ rotate: "90deg" }] },
    fill: { flex: 1 },
    tapToExpand: {
      position: "absolute",
      bottom: 12,
      alignSelf: "center",
      height: 28,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colours.hairline,
      backgroundColor: colours.raised,
    },
    tapLabel: { ...mobileType.footnote, color: colours.textDefault },
    stopped: { padding: 16, gap: 4 },
    stoppedTitle: { ...mobileType.subhead, fontWeight: "500", color: colours.textDefault },
    stoppedBody: { ...mobileType.footnote, color: colours.textSubtle },
    sheet: {
      flex: 1,
      backgroundColor: colours.panel,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: "hidden",
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 5,
      borderRadius: 3,
      marginTop: 6,
      backgroundColor: colours.hairline,
    },
    sheetHeader: {
      height: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 18,
    },
    sheetTitle: { ...mobileType.heading, fontWeight: "600", color: colours.textStrong, flex: 1 },
    done: {
      height: 30,
      paddingHorizontal: 14,
      justifyContent: "center",
      borderRadius: 15,
      backgroundColor: colours.raised,
      borderWidth: 1,
      borderColor: colours.hairline,
    },
    doneLabel: { ...mobileType.footnote, fontWeight: "500", color: colours.textStrong },
    sheetBody: { flex: 1, paddingHorizontal: 18, paddingTop: 6 },
  }) as const;
