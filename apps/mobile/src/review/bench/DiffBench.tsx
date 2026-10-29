/**
 * The diff bench (ENG-458): Review on a synthetic 2,000-line Turn, timed on the device. It parses
 * the patch with Pierre's parser, then records frame intervals while the list scrolls, driven
 * from JS at a fast fling's speed ("auto") or by real swipes ("manual"), and shows the numbers.
 */
import { mobileType } from "@polaris/ui/tokens";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from "react-native";
import { themedStyles } from "../../theme/index.ts";
import { type DiffFileInput, type DiffRow, diffRows } from "../diffRows.ts";
import { acceptState } from "../model.ts";
import { parsePatch } from "../patch.ts";
import { ReviewView } from "../ReviewView.tsx";
import { benchPatch, benchSummary } from "./fixture.ts";
import { displayBudget, frameStats, statsLine } from "./frames.ts";

export type BenchMode = "auto" | "manual";

/** Points per second: a fast fling. */
const SPEED = 5000;

const SETTLE_MS = 1500;

const MANUAL_MS = 15_000;

const IDLE_FRAMES = 90;

const noop = () => {};

const prepare = (lines: number) => {
  const start = performance.now();
  const { patch } = benchPatch(lines);
  const generated = performance.now();

  const files = parsePatch(patch).map((diff): DiffFileInput => ({
    diff,
    added: diff.hunks.reduce((n, h) => n + h.additionLines, 0),
    removed: diff.hunks.reduce((n, h) => n + h.deletionLines, 0),
  }));

  const parsed = performance.now();
  const summary = benchSummary();
  const rows = diffRows(files, summary.findings, new Set(files.map((f) => f.diff.name)));

  return {
    files,
    summary,
    rows: rows.length,
    lines: rows.filter((r) => r.kind === "line").length,
    bytes: patch.length,
    generateMs: generated - start,
    parseMs: parsed - generated,
    rowsMs: performance.now() - parsed,
  };
};

/** Frame intervals from requestAnimationFrame until `stop` returns true. */
const recordFrames = (
  onFrame: (dt: number) => boolean,
  done: (intervals: Array<number>) => void
) => {
  const intervals: Array<number> = [];
  let last: number | null = null;
  let id = 0;

  const tick = (now: number) => {
    if (last !== null) intervals.push(now - last);
    const stop = onFrame(last === null ? 0 : now - last);
    last = now;

    if (stop) done(intervals);
    else id = requestAnimationFrame(tick);
  };

  id = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(id);
};

export const DiffBench = ({
  lines = 2000,
  mode = "auto",
  colourblind = false,
}: {
  lines?: number;
  mode?: BenchMode;
  colourblind?: boolean;
}) => {
  const styles = useStyles();
  const prepared = useMemo(() => prepare(lines), [lines]);
  const list = useRef<FlatList<DiffRow>>(null);
  const events: Array<number> = [];
  const scroll = useRef({ offset: 0, content: 0, viewport: 0, events });
  const [report, setReport] = useState("Settling…");

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scroll.current.offset = contentOffset.y;
    scroll.current.content = contentSize.height;
    scroll.current.viewport = layoutMeasurement.height;
    scroll.current.events.push(event.timeStamp);
  };

  useEffect(() => {
    let cancel = noop;
    const head = `${prepared.lines} lines, ${prepared.rows} rows, ${Math.round(prepared.bytes / 1024)} KB · parse ${prepared.parseMs.toFixed(1)} ms · rows ${prepared.rowsMs.toFixed(1)} ms`;

    const measure = (budget: number) => {
      let offset = 0;
      let direction = 1;
      let elapsed = 0;
      scroll.current.events = [];

      cancel = recordFrames(
        (dt) => {
          elapsed += dt;

          if (mode === "manual") return elapsed > MANUAL_MS;

          // The content height is known only after the first scroll event.
          const end =
            scroll.current.content === 0
              ? Number.POSITIVE_INFINITY
              : Math.max(0, scroll.current.content - scroll.current.viewport);

          offset = Math.min(end, Math.max(0, offset + direction * SPEED * (dt / 1000)));
          list.current?.scrollToOffset({ offset, animated: false });

          if (direction === 1 && end > 0 && offset >= end) direction = -1;

          return direction === -1 && offset <= 0;
        },
        (intervals) => {
          const events = scroll.current.events
            .slice(1)
            .map((t, i) => t - (scroll.current.events[i] ?? t));

          const js = frameStats(intervals, budget);

          const native = frameStats(
            events.filter((dt) => dt > 0),
            budget
          );

          const text = [
            head,
            `${mode} scroll over ${Math.round(scroll.current.content)} pt`,
            statsLine("JS frames", js),
            statsLine("Scroll events", native),
          ].join("\n");

          setReport(text);
          console.log(
            `POLARIS_DIFF_BENCH ${JSON.stringify({ mode, prepared: { ...prepared, files: undefined, summary: undefined }, js, native, content: scroll.current.content })}`
          );
        }
      );
    };

    const settle = setTimeout(() => {
      let idle = 0;
      setReport(`${head}\nMeasuring the display…`);
      cancel = recordFrames(
        () => (idle += 1) > IDLE_FRAMES,
        (intervals) => {
          setReport(`${head}\n${mode === "manual" ? "Swipe for 15 s…" : "Scrolling…"}`);
          measure(displayBudget(intervals));
        }
      );
    }, SETTLE_MS);

    return () => {
      clearTimeout(settle);
      cancel();
    };
  }, [prepared, mode]);

  return (
    <View style={styles.screen}>
      <ReviewView
        turnNumber={24}
        sessionTitle="Diff bench"
        harnessName="Claude Code"
        files={prepared.files}
        diffProblem={null}
        summary={prepared.summary}
        accept={acceptState({
          risk: { kind: "ready", value: prepared.summary },
          turnEnded: true,
          accepted: false,
          sending: false,
        })}
        colourblind={colourblind}
        openAll
        notice={null}
        sent={new Set()}
        onAccept={noop}
        onSendBack={noop}
        onAskToFix={noop}
        onVerdict={noop}
        listRef={list}
        onScroll={onScroll}
      />
      <View pointerEvents="none" style={styles.report}>
        <Text style={styles.reportText}>{report}</Text>
      </View>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1 },
  report: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 96,
    padding: 8,
    borderRadius: 8,
    backgroundColor: `${colours.raised}e6`,
  },
  reportText: { ...mobileType.index, fontSize: 11, lineHeight: 14, color: colours.textStrong },
}));
