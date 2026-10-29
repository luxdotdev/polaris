/** The window's safe-area insets on the edges this half of the Duo touches. */
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Edges, edgeInsets } from "./edges.ts";
import type { Rect } from "./posture.ts";

export const useEdgeInsets = (rect: Rect): Edges =>
  edgeInsets(rect, useWindowDimensions(), useSafeAreaInsets());
