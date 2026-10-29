/**
 * The severity pager's state on screen: where each pill has paged to, which findings the user
 * unfolded, where each finding sits, and whether the hero's readout has scrolled away (pinning
 * MX-O's compact row under the header).
 */
import type { RiskFinding, Severity } from "@polaris/protocol";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from "react-native";
import { useReducedMotion } from "../../theme/index.ts";
import { keepPositions, NO_POSITIONS, pageTo } from "./pager.ts";

/** The pinned row's height: a paged-to finding lands just under it. */
export const PINNED_HEIGHT = 44;

export const usePager = (
  findings: ReadonlyArray<RiskFinding>,
  scroll: RefObject<ScrollViewInstance | null>
) => {
  const reduced = useReducedMotion();
  const [paged, setPaged] = useState(NO_POSITIONS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState(false);
  const places = useRef(new Map<string, number>());
  const heroTop = useRef(0);
  const readoutBottom = useRef(Number.POSITIVE_INFINITY);
  const positions = useMemo(() => keepPositions(findings, paged), [findings, paged]);

  const onPage = useCallback(
    (severity: Severity) => {
      const page = pageTo(findings, positions, severity);

      if (page === null) return;
      const { id } = page.finding;

      setPaged(page.positions);
      setExpanded((open) => (open.has(id) ? open : new Set([...open, id])));
      // After the unfolded finding lays out; its top doesn't move when it opens.
      requestAnimationFrame(() => {
        const y = places.current.get(id) ?? 0;

        scroll.current?.scrollTo({ y: Math.max(0, y - PINNED_HEIGHT - 8), animated: !reduced });
      });
    },
    [findings, positions, scroll, reduced]
  );

  const onExpand = useCallback((id: string) => setExpanded((open) => new Set([...open, id])), []);

  const onPlace = useCallback((id: string, y: number) => places.current.set(id, y), []);

  const onHeroTop = useCallback((y: number) => (heroTop.current = y), []);

  const onReadoutBottom = useCallback((y: number) => (readoutBottom.current = y), []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y >= heroTop.current + readoutBottom.current;

    setPinned((was) => (was === next ? was : next));
  }, []);

  return {
    positions,
    expanded,
    pinned,
    onPage,
    onExpand,
    onPlace,
    onHeroTop,
    onReadoutBottom,
    onScroll,
  };
};
