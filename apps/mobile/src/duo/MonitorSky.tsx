/**
 * The monitor's top half (Paper MX-AF): the night sky with the time and what's going on, and the
 * agent sessions as their celestials standing on the horizon, each labelled below the ridge.
 */
import { mobileFont, mobileWeight } from "@polaris/ui/tokens";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { Celestial } from "../celestial/index.tsx";
import { useConstellationProgress } from "../home/ui/constellationProgress.ts";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import type { skyLine, Star } from "./monitor.ts";
import type { Rect as Box } from "./posture.ts";
import { ridgePath, ridgeRise, SKY_FRAME, SKY_PALETTES, SKY_STARS } from "./sky.ts";

/** The clock moves once a minute, on the minute. */
export const useMinute = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const next = new Date();
      setNow(next);
      timer = setTimeout(tick, 60_000 - (next.getTime() % 60_000));
    };

    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));

    return () => clearTimeout(timer);
  }, []);

  return now;
};

const clock = (now: Date) => {
  const hours = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;

  return `${hours}:${String(now.getMinutes()).padStart(2, "0")}`;
};

/** MX-AF's sessions stand 24pt tall; a lead's star is 16. */
const SESSION_SIZE = 24;

const LEAD_SIZE = 16;

/** The labels' foot sits this far above the sky's, under the ridge. */
const LABEL_RISE = 32;

const Scene = ({ width, height }: { readonly width: number; readonly height: number }) => {
  const { name } = useTheme();
  const palette = SKY_PALETTES[name];
  const k = width / SKY_FRAME.width;

  return (
    <Svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Defs>
        <LinearGradient id="duo-sky" x1="0" y1="0" x2="0" y2="1">
          {palette.stops.map(([offset, color]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#duo-sky)" />
      <G opacity={palette.stars}>
        {SKY_STARS.map(([x, y, r, opacity]) => (
          <Circle key={`${x},${y}`} cx={x * k} cy={y} r={r} fill="#ffffff" opacity={opacity} />
        ))}
      </G>
      <Path d={ridgePath(width, height, true)} fill={palette.ridge} />
      <Path d={ridgePath(width, height, false)} fill="none" stroke={palette.ridgeEdge} />
    </Svg>
  );
};

const LeadCount = ({ lead }: { readonly lead: NonNullable<Star["lead"]> }) => {
  const progress = useConstellationProgress(lead.hostId, lead.constellationId, true);

  return progress === null ? null : ` ${progress.done}/${progress.total}`;
};

const StarView = ({ star, sky }: { readonly star: Star; readonly sky: Box }) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const size = star.lead === null ? SESSION_SIZE : LEAD_SIZE;
  const x = star.x * sky.width;
  const slot = Math.min(sky.width / 2, 120);

  return (
    <>
      <View style={[styles.body, { left: x - size / 2, bottom: ridgeRise(x, sky.width) }]}>
        <Celestial
          body={star.body}
          harness={star.harness ?? ""}
          size={size}
          working={star.working}
        />
      </View>
      <Text
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
        numberOfLines={1}
        style={[
          styles.label,
          { left: x - slot / 2, width: slot, bottom: LABEL_RISE },
          star.tone === "needs-you" ? { color: colours.needsYouText } : null,
        ]}
      >
        {star.label}
        {star.lead === null ? null : <LeadCount lead={star.lead} />}
      </Text>
    </>
  );
};

export interface MonitorSkyProps {
  readonly rect: Box;
  readonly stars: ReadonlyArray<Star>;
  readonly now: Date;
  readonly line: ReturnType<typeof skyLine>;
}

export const MonitorSky = ({ rect, stars, now, line }: MonitorSkyProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const calm = line.working === "" && line.needsYou === "";

  return (
    <View style={[styles.sky, { height: rect.height }]}>
      <Scene width={rect.width} height={rect.height} />
      <Text style={styles.time} accessibilityRole="header" maxFontSizeMultiplier={1}>
        {clock(now)}
      </Text>
      <Text style={styles.line} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
        {calm ? "Nothing needs you" : line.working}
        {line.working !== "" && line.needsYou !== "" ? " · " : ""}
        <Text style={{ color: colours.needsYouText }}>{line.needsYou}</Text>
      </Text>
      {stars.map((star) => (
        <StarView key={star.key} star={star} sky={rect} />
      ))}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  sky: { overflow: "hidden", alignItems: "center", paddingTop: 70 },
  time: {
    fontFamily: mobileFont.sans,
    fontSize: 112,
    lineHeight: 112,
    fontWeight: "200",
    letterSpacing: -2.24,
    color: colours.textDefault,
    fontVariant: ["tabular-nums"],
  },
  line: {
    fontFamily: mobileFont.sans,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: mobileWeight.regular,
    paddingTop: 14,
    color: colours.textDefault,
  },
  body: { position: "absolute" },
  label: {
    position: "absolute",
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
    color: colours.textSubtle,
  },
}));
